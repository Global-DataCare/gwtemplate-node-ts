#!/usr/bin/env bash
# Root deployment entrypoint for Cloud Run and GKE demo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(dirname "$SCRIPT_DIR")"
DEFAULT_FABRIC_MULTICLOUD_DIR="${WORKSPACE_ROOT}/fabric-multicloud"
DEFAULT_FABRIC_MULTICLOUD_HINT="../fabric-multicloud"
LEGACY_INTERNAL_FABRIC_MULTICLOUD_DIR="${SCRIPT_DIR}/fabric-multicloud"

resolve_fabric_multicloud_dir() {
  local requested_dir="${FABRIC_MULTICLOUD_DIR:-$DEFAULT_FABRIC_MULTICLOUD_DIR}"
  local resolved_dir

  resolved_dir="$(cd "$requested_dir" 2>/dev/null && pwd)" || {
    echo "❌ ERROR: FABRIC_MULTICLOUD_DIR does not exist: $requested_dir"
    exit 1
  }

  if [[ "$resolved_dir" == "$LEGACY_INTERNAL_FABRIC_MULTICLOUD_DIR" ]]; then
    echo "❌ ERROR: legacy internal fabric-multicloud is no longer accepted for deployment."
    echo "Set FABRIC_MULTICLOUD_DIR to the workspace sibling repo instead:"
    echo "  ${DEFAULT_FABRIC_MULTICLOUD_HINT}"
    exit 1
  fi

  if [[ ! -f "$resolved_dir/scripts/05-k8s-deploy-gdc.sh" ]]; then
    echo "❌ ERROR: FABRIC_MULTICLOUD_DIR is missing scripts/05-k8s-deploy-gdc.sh"
    echo "Resolved path: $resolved_dir"
    exit 1
  fi

  FABRIC_MULTICLOUD_DIR="$resolved_dir"
  export FABRIC_MULTICLOUD_DIR
}

resolve_fabric_multicloud_dir

usage() {
  cat <<'EOF'
Usage:
  ./cloud_deploy.sh <staging|production|...>       Deploy to Cloud Run using .env.deploy.<env>
  ./cloud_deploy.sh gke <profile> [config-file]   Deploy to GKE using .env.gke.<profile>
  ./cloud_deploy.sh gke-demo [config-file]        Backward-compatible alias for demo GKE deployment
EOF
}

source_env_file() {
  local env_file="$1"

  if [[ ! -f "$env_file" ]]; then
    echo "❌ ERROR: Configuration file not found: $env_file"
    exit 1
  fi

  set -a
  source "$env_file"
  set +a
}

require_canonical_sector_catalog() {
  if [[ -z "${ALLOWED_SECTORS:-}" ]]; then
    echo "ERROR: ALLOWED_SECTORS is required for every gateway deployment." >&2
    exit 1
  fi
}

resolve_versioned_image() {
  local image_ref="$1"
  local explicit_tag="${2:-}"
  local mutable_tags="${3:-latest,demo}"
  local package_version git_sha computed_tag image_repo image_tag
  local mutable_tag

  if [[ "$image_ref" == *@sha256:* ]]; then
    echo "$image_ref"
    return 0
  fi

  package_version="$(node -p "require('./package.json').version")"
  git_sha="$(git rev-parse --short HEAD)"
  computed_tag="${explicit_tag:-${package_version}-${git_sha}}"

  if [[ "$image_ref" == *:* ]]; then
    image_repo="${image_ref%:*}"
    image_tag="${image_ref##*:}"
  else
    image_repo="$image_ref"
    image_tag=""
  fi

  if [[ -z "$image_tag" ]]; then
    echo "${image_repo}:${computed_tag}"
    return 0
  fi

  IFS=',' read -r -a mutable_tag_list <<< "$mutable_tags"
  for mutable_tag in "${mutable_tag_list[@]}"; do
    if [[ "$image_tag" == "$mutable_tag" ]]; then
      echo "${image_repo}:${computed_tag}"
      return 0
    fi
  done

  echo "$image_ref"
}

resolve_pushed_digest() {
  local image_ref="$1"
  local image_repo repo_digest

  if [[ "$image_ref" == *@sha256:* ]]; then
    echo "$image_ref"
    return 0
  fi

  image_repo="${image_ref%:*}"
  while IFS= read -r repo_digest; do
    if [[ "$repo_digest" == "${image_repo}@"* ]]; then
      echo "$repo_digest"
      return 0
    fi
  done < <(docker image inspect "$image_ref" --format '{{range .RepoDigests}}{{println .}}{{end}}')

  echo "ERROR: pushed digest not found for ${image_ref}" >&2
  return 1
}

confirm_or_exit() {
  if [[ "${DEPLOY_CONFIRM:-false}" == "true" ]]; then
    return 0
  fi
  read -p "Are you sure you want to proceed with the deployment? (y/n): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "🛑 Deployment cancelled by user."
    exit 1
  fi
}

check_prereqs() {
  echo "⚙️  Checking prerequisites..."
  if ! docker info >/dev/null 2>&1; then
    echo "❌ ERROR: Docker is not running."
    exit 1
  fi
  echo "✅ Docker is running."

  echo "⚙️  Checking for TypeScript errors..."
  if ! npx tsc --noEmit; then
    echo "❌ ERROR: TypeScript compilation failed."
    exit 1
  fi
  echo "✅ No TypeScript errors found."
}

build_and_push_image() {
  local project_id="$1"
  local region="$2"
  local image_path="$3"
  local repo_name="$4"
  local service_hint="$5"
  local source_image="${6:-}"

  echo "⚙️  Configuring gcloud for project: $project_id"
  gcloud config set project "$project_id"

  echo "⚙️  Enabling required services..."
  gcloud services enable artifactregistry.googleapis.com
  if ! gcloud artifacts repositories describe "$repo_name" --location="$region" >/dev/null 2>&1; then
    echo "⚙️  Creating Artifact Registry repository: $repo_name in $region"
    gcloud artifacts repositories create "$repo_name" \
      --repository-format=docker \
      --location="$region" \
      --description="Docker repository for $service_hint"
  else
    echo "✅ Artifact Registry repository '$repo_name' already exists."
  fi

  echo "⚙️  Configuring Docker to authenticate with GCP..."
  gcloud auth configure-docker "${region}-docker.pkg.dev"

  if [[ "${SKIP_BUILD:-false}" == "true" ]]; then
    local local_image="${source_image:-gwtemplate}"
    echo "⚙️  SKIP_BUILD=true, reusing local image '$local_image'"
    if ! docker image inspect "$local_image" >/dev/null 2>&1; then
      echo "❌ ERROR: local image '$local_image' not found."
      echo "Build it first, for example with ./docker_build_local.sh"
      exit 1
    fi
    docker tag "$local_image" "$image_path"
  else
    echo "⚙️  Building the Docker image: $image_path"
    if [[ -n "${NPM_TOKEN:-}" ]]; then
      echo "(NPM_TOKEN found, passing it as a build argument)"
      docker build --platform "${DOCKER_PLATFORM:-linux/amd64}" --build-arg NPM_TOKEN="$NPM_TOKEN" -t "$image_path" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"
    else
      echo "(NPM_TOKEN not found, building without it)"
      docker build --platform "${DOCKER_PLATFORM:-linux/amd64}" -t "$image_path" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"
    fi
  fi

  echo "⚙️  Pushing the image to Artifact Registry..."
  docker push "$image_path"
}

deploy_cloud_run() {
  local env_name="$1"
  local env_file=".env.deploy.${env_name}"

  source_env_file "$env_file"
  require_canonical_sector_catalog

  if [[ -z "${FIRESTORE_PROJECT_ID:-}" || -z "${DEPLOY_REGION:-}" || -z "${DEPLOY_SERVICE_NAME:-}" || -z "${ARTIFACT_REGISTRY_NAME:-}" ]]; then
    echo "ERROR: Missing FIRESTORE_PROJECT_ID, DEPLOY_REGION, DEPLOY_SERVICE_NAME, or ARTIFACT_REGISTRY_NAME."
    exit 1
  fi

  local repo_name="$ARTIFACT_REGISTRY_NAME"
  local image_repository="${DEPLOY_REGION}-docker.pkg.dev/${FIRESTORE_PROJECT_ID}/${repo_name}/${DEPLOY_SERVICE_NAME}"
  local requested_image_ref="${DEPLOY_IMAGE:-${image_repository}:latest}"
  local image_path
  image_path="$(resolve_versioned_image "$requested_image_ref" "${DEPLOY_IMAGE_TAG:-}" "latest")"

  echo "--- 🚀 Preparing for GCP Deployment to '$env_name' ---"
  echo "  Service Name:       $DEPLOY_SERVICE_NAME"
  echo "  Project ID:         $FIRESTORE_PROJECT_ID"
  echo "  Region:             $DEPLOY_REGION"
  echo "  Image:              $image_path"
  echo "  External Domain:    ${HOST_EXTERNAL_DOMAIN:-}"
  echo "  External Port:      ${HOST_EXTERNAL_PORT:-}"
  echo "  Database Provider:  ${DB_PROVIDER:-}"
  echo "  Queue Provider:     ${QUEUE_PROVIDER:-}"
  echo "  Storage Provider:   ${STORAGE_PROVIDER:-}"
  echo "  GCS Bucket Name:    ${GCS_BUCKET_NAME:-}"
  confirm_or_exit

  check_prereqs

  echo "⚙️  Enabling required Cloud Run services..."
  gcloud config set project "$FIRESTORE_PROJECT_ID"
  gcloud services enable run.googleapis.com artifactregistry.googleapis.com

  build_and_push_image "$FIRESTORE_PROJECT_ID" "$DEPLOY_REGION" "$image_path" "$repo_name" "$DEPLOY_SERVICE_NAME" "${LOCAL_IMAGE_NAME:-gwtemplate}"

  echo "⚙️  Preparing runtime environment variables for Cloud Run..."
  local temp_env_file
  temp_env_file="$(mktemp "${TMPDIR:-/tmp}/gwtemplate-cloud-run-env.XXXXXX.yaml")"
  trap "rm -f -- '$temp_env_file'" EXIT
  > "$temp_env_file"

  local runtime_vars=(
    "NODE_ENV"
    "HOST_EXTERNAL_DOMAIN" "HOST_EXTERNAL_PORT"
    "LOCAL_SERVICE_ROLE"
    "SECURITY_MODE" "NETWORK_MODE" "FHIR_LEGACY" "JSON_LEGACY" "DIDCOMM_PLAIN" "DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE" "DEMO_ALLOW_INSECURE_BEARER"
    "AUTH_TOKEN_VERIFIER" "TENANT_SERVICE_ROUTES_JSON"
    "ICA_MODE" "ICA_URL_INTERNAL" "ICA_URL_EXTERNAL" "ICA_TLS_CA_PEM"
    "ICA_EXTERNAL_DOMAIN" "CA_EXTERNAL_DOMAIN"
    "DEV_SEED" "ALLOWED_SECTORS" "SECTORS_ALLOWED"
    "DISABLED_DEFAULT_SECTORS" "DISABLED_DEFAULT_SECTORS_REASON"
    "HOST_LEGAL_NAME" "HOST_JURISDICTION" "HOST_ID_TYPE" "HOST_ID_VALUE"
    "HOST_ADMIN_EMAIL" "HOST_ADMIN_UID" "HOST_ADMIN_ROLE" "HOST_TERMS_URL"
    "ORG_HOST_LEGAL_NAME" "ORG_HOST_JURISDICTION" "ORG_HOST_ID_TYPE" "ORG_HOST_ID_VALUE"
    "ORG_HOST_ADMIN_EMAIL" "ORG_HOST_ADMIN_UID" "ORG_HOST_ADMIN_ROLE" "ORG_HOST_TERMS_URL"
    "ENVELOPE_PROVIDER" "KEK_SECRET" "GCP_KMS_KEY_NAME" "GCP_KMS_RUNTIME_KEK_CIPHERTEXT" "GCP_KMS_RUNTIME_KEK_ID"
    "HASHICORP_TRANSIT_BASE_URL" "HASHICORP_TRANSIT_MOUNT_PATH" "HASHICORP_TRANSIT_KEY_NAME" "HASHICORP_TRANSIT_TOKEN" "HASHICORP_NAMESPACE"
    "QUEUE_PROVIDER" "DB_PROVIDER" "STORAGE_PROVIDER" "FIRESTORE_PROJECT_ID"
    "GCS_BUCKET_NAME" "FIREBASE_API_KEY"
  )

  local var_name
  for var_name in "${runtime_vars[@]}"; do
    local var_value="${!var_name:-}"
    if [[ -n "$var_value" ]]; then
      echo "$var_name: \"$var_value\"" >> "$temp_env_file"
    fi
  done

  echo "⚙️  Deploying to Cloud Run service: $DEPLOY_SERVICE_NAME in $DEPLOY_REGION"
  gcloud run deploy "$DEPLOY_SERVICE_NAME" \
    --image="$image_path" \
    --platform="managed" \
    --region="$DEPLOY_REGION" \
    --port="3000" \
    --env-vars-file="$temp_env_file" \
    --allow-unauthenticated

  local service_url
  service_url="$(gcloud run services describe "$DEPLOY_SERVICE_NAME" --platform="managed" --region="$DEPLOY_REGION" --format='value(status.url)')"
  echo "--- ✅ Deployment Successful ---"
  echo "Service Name: $DEPLOY_SERVICE_NAME"
  echo "Service URL: $service_url"
  echo "You can check the interactive API docs at: ${service_url}/api-docs"
}

deploy_gke() {
  local profile="$1"
  local config_file="${2:-demo-deploy.config}"
  local env_file=".env.gke.${profile}"

  source_env_file "$env_file"

  if [[ ! -f "$config_file" ]]; then
    echo "❌ ERROR: GKE config file not found: $config_file"
    echo "Create it from demo-deploy.config.example first."
    exit 1
  fi

  source_env_file "$config_file"
  require_canonical_sector_catalog

  GDC_IMAGE="$(resolve_versioned_image "${GDC_IMAGE:-}" "${GDC_IMAGE_TAG:-}" "latest,demo")"
  export GDC_IMAGE
  local required_vars=(
    GCP_PROJECT_ID GCP_REGION GKE_CLUSTER
    K8S_NAMESPACE_GDC GDC_IMAGE GDC_PUBLIC_URL GDC_STATIC_IP_NAME GDC_GSA_EMAIL
  )
  local var_name
  for var_name in "${required_vars[@]}"; do
    if [[ -z "${!var_name:-}" ]]; then
      echo "ERROR: Missing required variable in $config_file: $var_name"
      exit 1
    fi
  done

  local image_host_and_project remainder repo_name
  image_host_and_project="${GDC_IMAGE#*/}"
  remainder="${image_host_and_project#*/}"
  repo_name="${remainder%%/*}"

  echo "--- 🚀 Preparing for GKE deployment ---"
  echo "  Profile:            $profile"
  echo "  Project ID:         $GCP_PROJECT_ID"
  echo "  Region:             $GCP_REGION"
  echo "  Cluster:            $GKE_CLUSTER"
  echo "  Namespace:          $K8S_NAMESPACE_GDC"
  echo "  Image:              $GDC_IMAGE"
  echo "  Public URL:         $GDC_PUBLIC_URL"
  echo "  Static IP Name:     $GDC_STATIC_IP_NAME"
  echo "  Runtime Providers:  DB=${DB_PROVIDER:-} STORAGE=${STORAGE_PROVIDER:-} QUEUE=${QUEUE_PROVIDER:-}"

  if [[ "${DEPLOY_DRY_RUN:-false}" == "true" ]]; then
    echo "✅ GKE deployment configuration validated (dry run)."
    return 0
  fi

  confirm_or_exit

  check_prereqs

  echo "⚙️  Configuring gcloud for project: $GCP_PROJECT_ID"
  gcloud config set project "$GCP_PROJECT_ID"
  echo "⚙️  Enabling required GKE services..."
  gcloud services enable container.googleapis.com artifactregistry.googleapis.com

  build_and_push_image "$GCP_PROJECT_ID" "$GCP_REGION" "$GDC_IMAGE" "$repo_name" "gwtemplate-gke-${profile}" "${LOCAL_IMAGE_NAME:-gwtemplate}"
  GDC_IMAGE="$(resolve_pushed_digest "$GDC_IMAGE")"
  export GDC_IMAGE
  echo "✅ Deploying immutable digest: ${GDC_IMAGE}"

  echo "⚙️  Fetching GKE credentials for cluster: $GKE_CLUSTER"
  gcloud container clusters get-credentials "$GKE_CLUSTER" --region "$GCP_REGION"

  echo "⚙️  Applying GW GKE manifests..."
  bash "$FABRIC_MULTICLOUD_DIR/scripts/05-k8s-deploy-gdc.sh"

  local resource_name="${GDC_RESOURCE_NAME:-gwtemplate}"
  if [[ -n "${ALLOWED_SECTORS:-}" ]]; then
    echo "⚙️  Applying canonical gateway sector catalog..."
    kubectl -n "$K8S_NAMESPACE_GDC" set env "deployment/${resource_name}" \
      ALLOWED_SECTORS="$ALLOWED_SECTORS" \
      DISABLED_DEFAULT_SECTORS="${DISABLED_DEFAULT_SECTORS:-}" \
      DISABLED_DEFAULT_SECTORS_REASON="${DISABLED_DEFAULT_SECTORS_REASON:-}"
  fi
  if [[ -n "${HOST_LEGACY_REPRESENTATIVE_CONTROLLER:-}" ]]; then
    echo "⚙️  Applying legacy representative-controller compatibility policy..."
    kubectl -n "$K8S_NAMESPACE_GDC" set env "deployment/${resource_name}" \
      HOST_LEGACY_REPRESENTATIVE_CONTROLLER="$HOST_LEGACY_REPRESENTATIVE_CONTROLLER"
  fi
  kubectl -n "$K8S_NAMESPACE_GDC" rollout status "deployment/${resource_name}" --timeout="${ROLLOUT_TIMEOUT:-180s}"
  curl --fail --silent --show-error --max-time 20 "${GDC_PUBLIC_URL%/}/host/ping" >/dev/null
  curl --fail --silent --show-error --max-time 20 "${GDC_PUBLIC_URL%/}/api-docs/" >/dev/null

  echo "--- ✅ GKE deployment submitted ---"
  echo "Public URL: $GDC_PUBLIC_URL"
  echo "Once the LoadBalancer service is ready, test:"
  echo "  ${GDC_PUBLIC_URL}/host/ping"
  echo "  ${GDC_PUBLIC_URL}/api-docs"
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local mode="$1"
  shift || true

  case "$mode" in
    gke)
      if [[ $# -lt 1 ]]; then
        echo "❌ ERROR: Missing GKE profile."
        usage
        exit 1
      fi
      deploy_gke "$1" "${2:-demo-deploy.config}"
      ;;
    gke-demo)
      deploy_gke "gdc" "${1:-demo-deploy.config}"
      ;;
    *)
      deploy_cloud_run "$mode"
      ;;
  esac
}

main "$@"
