#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_GDC:-}" ]]; then
  echo "Missing K8S_NAMESPACE_GDC. Source private-deploy.config or demo-deploy.config first."
  exit 1
fi

required_vars=(
  K8S_NAMESPACE_GDC
  GDC_IMAGE
  GDC_PUBLIC_URL
  GDC_STATIC_IP_NAME
  GCP_PROJECT_ID
  GDC_GSA_EMAIL
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required variable: ${var_name}"
    exit 1
  fi
done

optional_env_defaults=(
  "NODE_ENV=demo"
  "SECURITY_MODE=compat"
  "NETWORK_MODE=test"
  "FHIR_LEGACY=true"
  "JSON_LEGACY=true"
  "DIDCOMM_PLAIN=disabled"
  "DEMO_ALLOW_INSECURE_BEARER=false"
  "DEV_SEED=true"
  "SECTORS_ALLOWED=health-care,test"
  "QUEUE_PROVIDER=mem"
  "DB_PROVIDER=mem"
  "STORAGE_PROVIDER=mem"
  "LOG_PROVIDER=console"
  "REPLAY_PROTECTION_PROVIDER=none"
  "EMAIL_NOTIFICATION_PROVIDER=console"
  "CLEARING_HOUSE_MODE=stub"
  "ICA_MODE="
  "HOST_LEGAL_NAME=Gateway Host Services"
  "HOST_JURISDICTION=ES"
  "HOST_ID_TYPE=TAX"
  "HOST_ID_VALUE=A0011223344"
  "HOST_ADMIN_EMAIL=admin@host.com"
  "HOST_ADMIN_UID=host-admin-001"
  "HOST_ADMIN_ROLE=ISCO-08|1111"
  "HOST_TERMS_URL=${GDC_PUBLIC_URL}/terms"
  "GCS_BUCKET_NAME="
)

for entry in "${optional_env_defaults[@]}"; do
  key="${entry%%=*}"
  value="${entry#*=}"
  export "${key}=${!key:-$value}"
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR%/scripts}/k8s/gdc"
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "$RENDER_DIR"' EXIT

render_template() {
  local src="$1"
  local dest="$2"
  sed \
    -e "s|__K8S_NAMESPACE_GDC__|${K8S_NAMESPACE_GDC}|g" \
    -e "s|__GDC_IMAGE__|${GDC_IMAGE}|g" \
    -e "s|__GDC_PUBLIC_URL__|${GDC_PUBLIC_URL}|g" \
    -e "s|__GDC_STATIC_IP_NAME__|${GDC_STATIC_IP_NAME}|g" \
    -e "s|__GCP_PROJECT_ID__|${GCP_PROJECT_ID}|g" \
    -e "s|__GCS_BUCKET_NAME__|${GCS_BUCKET_NAME}|g" \
    -e "s|__NODE_ENV__|${NODE_ENV}|g" \
    -e "s|__SECURITY_MODE__|${SECURITY_MODE}|g" \
    -e "s|__NETWORK_MODE__|${NETWORK_MODE}|g" \
    -e "s|__FHIR_LEGACY__|${FHIR_LEGACY}|g" \
    -e "s|__JSON_LEGACY__|${JSON_LEGACY}|g" \
    -e "s|__DIDCOMM_PLAIN__|${DIDCOMM_PLAIN}|g" \
    -e "s|__DEMO_ALLOW_INSECURE_BEARER__|${DEMO_ALLOW_INSECURE_BEARER}|g" \
    -e "s|__DEV_SEED__|${DEV_SEED}|g" \
    -e "s|__SECTORS_ALLOWED__|${SECTORS_ALLOWED}|g" \
    -e "s|__QUEUE_PROVIDER__|${QUEUE_PROVIDER}|g" \
    -e "s|__DB_PROVIDER__|${DB_PROVIDER}|g" \
    -e "s|__STORAGE_PROVIDER__|${STORAGE_PROVIDER}|g" \
    -e "s|__LOG_PROVIDER__|${LOG_PROVIDER}|g" \
    -e "s|__REPLAY_PROTECTION_PROVIDER__|${REPLAY_PROTECTION_PROVIDER}|g" \
    -e "s|__EMAIL_NOTIFICATION_PROVIDER__|${EMAIL_NOTIFICATION_PROVIDER}|g" \
    -e "s|__CLEARING_HOUSE_MODE__|${CLEARING_HOUSE_MODE}|g" \
    -e "s|__ICA_MODE__|${ICA_MODE}|g" \
    -e "s|__HOST_LEGAL_NAME__|${HOST_LEGAL_NAME}|g" \
    -e "s|__HOST_JURISDICTION__|${HOST_JURISDICTION}|g" \
    -e "s|__HOST_ID_TYPE__|${HOST_ID_TYPE}|g" \
    -e "s|__HOST_ID_VALUE__|${HOST_ID_VALUE}|g" \
    -e "s|__HOST_ADMIN_EMAIL__|${HOST_ADMIN_EMAIL}|g" \
    -e "s|__HOST_ADMIN_UID__|${HOST_ADMIN_UID}|g" \
    -e "s|__HOST_ADMIN_ROLE__|${HOST_ADMIN_ROLE}|g" \
    -e "s|__HOST_TERMS_URL__|${HOST_TERMS_URL}|g" \
    -e "s|__GDC_GSA_EMAIL__|${GDC_GSA_EMAIL}|g" \
    -e "s|__DATASPACE_ICA_EXTERNAL_URL__|${DATASPACE_ICA_EXTERNAL_URL:-}|g" \
    "$src" > "$dest"
}

kubectl get namespace "${K8S_NAMESPACE_GDC}" >/dev/null 2>&1 || kubectl create namespace "${K8S_NAMESPACE_GDC}"

for file in namespace.yaml serviceaccount.yaml configmap.yaml deployment.yaml service.yaml; do
  render_template "${TEMPLATE_DIR}/${file}" "${RENDER_DIR}/${file}"
done

kubectl apply -f "${RENDER_DIR}/namespace.yaml"
kubectl apply -f "${RENDER_DIR}/serviceaccount.yaml"
kubectl apply -f "${RENDER_DIR}/configmap.yaml"

if kubectl -n "${K8S_NAMESPACE_GDC}" get secret gwtemplate-secret >/dev/null 2>&1; then
  echo "Applying deployment with existing secret 'gwtemplate-secret'."
else
  echo "ERROR: secret 'gwtemplate-secret' not found in namespace '${K8S_NAMESPACE_GDC}'."
  echo "Create it first from fabric-multicloud/k8s/gdc/secret.template.yaml."
  exit 1
fi

kubectl apply -f "${RENDER_DIR}/deployment.yaml"
kubectl apply -f "${RENDER_DIR}/service.yaml"

echo "GW manifests applied in namespace '${K8S_NAMESPACE_GDC}'."
echo "Service URL: ${GDC_PUBLIC_URL}"
echo "Static IP name: ${GDC_STATIC_IP_NAME}"
echo "Runtime mode: NODE_ENV=${NODE_ENV} DB_PROVIDER=${DB_PROVIDER} STORAGE_PROVIDER=${STORAGE_PROVIDER}"
if [[ -n "${DATASPACE_ICA_EXTERNAL_URL:-}" ]]; then
  echo "External ICA URL: ${DATASPACE_ICA_EXTERNAL_URL}"
else
  echo "External ICA URL: not configured"
fi
