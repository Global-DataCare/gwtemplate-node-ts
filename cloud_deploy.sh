#!/usr/bin/env bash
# Root deployment entrypoint for Cloud Run and GKE demo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(dirname "$SCRIPT_DIR")"

usage() {
  cat <<'EOF'
Usage:
  ./cloud_deploy.sh <staging|production|...>     Deploy to Cloud Run using .env.deploy.<env>
  ./cloud_deploy.sh gke-demo [config-file]       Deploy demo GW to GKE using demo-deploy.config
EOF
}

resolve_versioned_demo_image() {
  local image_ref="$1"
  local explicit_tag="${2:-}"
  local package_version git_sha computed_tag image_repo image_tag

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

  if [[ -z "$image_tag" || "$image_tag" == "demo" || "$image_tag" == "latest" ]]; then
    echo "${image_repo}:${computed_tag}"
    return 0
  fi

  echo "$image_ref"
}

confirm_or_exit() {
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
      docker build --build-arg NPM_TOKEN="$NPM_TOKEN" -t "$image_path" -f "$SCRIPT_DIR/Dockerfile" "$WORKSPACE_ROOT"
    else
      echo "(NPM_TOKEN not found, building without it)"
      docker build -t "$image_path" -f "$SCRIPT_DIR/Dockerfile" "$WORKSPACE_ROOT"
    fi
  fi

  echo "⚙️  Pushing the image to Artifact Registry..."
  docker push "$image_path"
}

deploy_cloud_run() {
  local env_name="$1"
  local env_file=".env.deploy.${env_name}"

  if [[ ! -f "$env_file" ]]; then
    echo "❌ ERROR: Configuration file for '$env_name' not found."
    exit 1
  fi

  set -a
  source "$env_file"
  set +a

  if [[ -z "${FIRESTORE_PROJECT_ID:-}" || -z "${DEPLOY_REGION:-}" || -z "${DEPLOY_SERVICE_NAME:-}" || -z "${ARTIFACT_REGISTRY_NAME:-}" ]]; then
    echo "ERROR: Missing FIRESTORE_PROJECT_ID, DEPLOY_REGION, DEPLOY_SERVICE_NAME, or ARTIFACT_REGISTRY_NAME."
    exit 1
  fi

  local repo_name="$ARTIFACT_REGISTRY_NAME"
  local image_path="${DEPLOY_REGION}-docker.pkg.dev/${FIRESTORE_PROJECT_ID}/${repo_name}/${DEPLOY_SERVICE_NAME}:latest"

  echo "--- 🚀 Preparing for GCP Deployment to '$env_name' ---"
  echo "  Service Name:       $DEPLOY_SERVICE_NAME"
  echo "  Project ID:         $FIRESTORE_PROJECT_ID"
  echo "  Region:             $DEPLOY_REGION"
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

  build_and_push_image "$FIRESTORE_PROJECT_ID" "$DEPLOY_REGION" "$image_path" "$repo_name" "$DEPLOY_SERVICE_NAME"

  echo "⚙️  Preparing runtime environment variables for Cloud Run..."
  local temp_env_file="temp_env.yaml"
  trap 'rm -f "$temp_env_file"' EXIT
  > "$temp_env_file"

  local runtime_vars=(
    "NODE_ENV"
    "HOST_EXTERNAL_DOMAIN" "HOST_EXTERNAL_PORT"
    "ICA_EXTERNAL_DOMAIN" "CA_EXTERNAL_DOMAIN"
    "DEV_SEED" "SECTORS_ALLOWED"
    "HOST_LEGAL_NAME" "HOST_JURISDICTION" "HOST_ID_TYPE" "HOST_ID_VALUE"
    "HOST_ADMIN_EMAIL" "HOST_ADMIN_UID" "HOST_ADMIN_ROLE" "HOST_TERMS_URL"
    "ORG_HOST_LEGAL_NAME" "ORG_HOST_JURISDICTION" "ORG_HOST_ID_TYPE" "ORG_HOST_ID_VALUE"
    "ORG_HOST_ADMIN_EMAIL" "ORG_HOST_ADMIN_UID" "ORG_HOST_ADMIN_ROLE" "ORG_HOST_TERMS_URL"
    "KEK_SECRET" "QUEUE_PROVIDER" "DB_PROVIDER" "STORAGE_PROVIDER" "FIRESTORE_PROJECT_ID"
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

deploy_gke_demo() {
  local config_file="${1:-demo-deploy.config}"
  if [[ ! -f "$config_file" ]]; then
    echo "❌ ERROR: GKE demo config file not found: $config_file"
    echo "Create it from demo-deploy.config.example first."
    exit 1
  fi

  set -a
  source "$config_file"
  set +a

  GDC_IMAGE="$(resolve_versioned_demo_image "${GDC_IMAGE:-}" "${GDC_IMAGE_TAG:-}")"
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

  echo "--- 🚀 Preparing for GKE demo deployment ---"
  echo "  Project ID:         $GCP_PROJECT_ID"
  echo "  Region:             $GCP_REGION"
  echo "  Cluster:            $GKE_CLUSTER"
  echo "  Namespace:          $K8S_NAMESPACE_GDC"
  echo "  Image:              $GDC_IMAGE"
  echo "  Public URL:         $GDC_PUBLIC_URL"
  echo "  Static IP Name:     $GDC_STATIC_IP_NAME"
  echo "  Runtime Providers:  DB=${DB_PROVIDER:-} STORAGE=${STORAGE_PROVIDER:-} QUEUE=${QUEUE_PROVIDER:-}"
  confirm_or_exit

  check_prereqs

  echo "⚙️  Configuring gcloud for project: $GCP_PROJECT_ID"
  gcloud config set project "$GCP_PROJECT_ID"
  echo "⚙️  Enabling required GKE services..."
  gcloud services enable container.googleapis.com artifactregistry.googleapis.com

  build_and_push_image "$GCP_PROJECT_ID" "$GCP_REGION" "$GDC_IMAGE" "$repo_name" "gwtemplate-gke-demo" "${LOCAL_IMAGE_NAME:-gwtemplate}"

  echo "⚙️  Fetching GKE credentials for cluster: $GKE_CLUSTER"
  gcloud container clusters get-credentials "$GKE_CLUSTER" --region "$GCP_REGION"

  echo "⚙️  Applying GW GKE manifests..."
  bash "$SCRIPT_DIR/fabric-multicloud/scripts/05-k8s-deploy-gdc.sh"

  echo "--- ✅ GKE demo deployment submitted ---"
  echo "Public URL: $GDC_PUBLIC_URL"
  echo "Once the LoadBalancer service is ready, test:"
  echo "  ${GDC_PUBLIC_URL}/host/.well-known/ping"
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
    gke-demo)
      deploy_gke_demo "${1:-demo-deploy.config}"
      ;;
    *)
      deploy_cloud_run "$mode"
      ;;
  esac
}

main "$@"
