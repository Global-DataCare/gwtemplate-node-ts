#!/usr/bin/env bash
# Flujo contractual Helm/Kubernetes para local-network:
# 1. Crea un clúster kind aislado y carga la imagen GW ya validada por Docker.
# 2. Despliega por Helm GW CORE, PostgreSQL e IPFS por referencias inmutables.
# 3. Conecta el GW al peer Host1MSP de la Fabric local-network mediante DNS local.
# 4. Ejecuta bootstrap de tenant, Consent e intercambio SMART positivo/negativo.
# 5. Reinicia GW y demuestra persistencia PostgreSQL/IPFS y recuperación del tenant.
# Autorización: Helm consume identidad/configuración ya preparadas; no registra MSP ni administra Fabric CA.
# Persistencia: el reinicio no rota claves ni pierde el DID o los blobs cifrados.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-gw-core:local}"
CLUSTER_NAME="${KIND_CLUSTER_NAME:-gdc-host-evidence}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
NAMESPACE="${HELM_EVIDENCE_NAMESPACE:-local-host-evidence}"
RELEASE="${HELM_EVIDENCE_RELEASE:-host-evidence}"
KEEP_CLUSTER="${KEEP_HELM_EVIDENCE_CLUSTER:-false}"
EVIDENCE_TENANT_ID="${HELM_EVIDENCE_TENANT_ID:-helm-evidence}"
EVIDENCE_SUBJECT_ID="did:web:api.${EVIDENCE_TENANT_ID}.org:individual:subject-001"
PREFLIGHT_ONLY=false
TEMP_DIR="$(mktemp -d)"
PORT_FORWARD_PID=""

if [[ "${1:-}" == "--preflight-only" ]]; then
  PREFLIGHT_ONLY=true
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "Uso: $0 [--preflight-only]" >&2
  exit 2
fi

cleanup() {
  if [[ -n "${PORT_FORWARD_PID}" ]]; then
    kill "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
    wait "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
  fi
  rm -rf "${TEMP_DIR}"
  if [[ "${KEEP_CLUSTER}" != "true" ]]; then
    kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for executable in docker kind kubectl helm jq curl awk openssl; do
  command -v "${executable}" >/dev/null || {
    echo "Falta el ejecutable requerido: ${executable}" >&2
    exit 2
  }
done
docker info >/dev/null

FABRIC_ENV="${FABRIC_ENV_FILE:-${ROOT}/.env.local-fabric}"
if [[ "${PREFLIGHT_ONLY}" == "true" ]]; then
  echo "Preflight Helm local-network superado."
  exit 0
fi
docker image inspect "${IMAGE_NAME}" >/dev/null
[[ -f "${FABRIC_ENV}" ]] || {
  echo "Falta ${FABRIC_ENV}; ejecute primero la prueba Docker local-network." >&2
  exit 2
}
docker ps --format '{{.Names}}' | grep -qx 'gdc-peer0-host1' || {
  echo 'No está activo el peer Docker gdc-peer0-host1.' >&2
  exit 2
}

kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
kind create cluster --name "${CLUSTER_NAME}" --wait 90s
kind load docker-image "${IMAGE_NAME}" --name "${CLUSTER_NAME}"

docker_image_id="$(docker image inspect "${IMAGE_NAME}" --format '{{.Id}}')"
kind_image_record="$(docker exec "${CLUSTER_NAME}-control-plane" crictl images -o json \
  | jq -c --arg image "${IMAGE_NAME}" '.images[] | select(any(.repoTags[]?; . == $image or endswith("/" + $image)))' \
  | head -n 1)"
kind_image_id="$(jq -r '.id' <<< "${kind_image_record}")"
kind_image_digest="$(jq -r '.repoDigests[0]' <<< "${kind_image_record}")"
[[ "${docker_image_id}" =~ ^sha256:[0-9a-f]{64}$ && "${kind_image_id}" =~ ^sha256:[0-9a-f]{64}$ && "${kind_image_digest}" =~ @sha256:[0-9a-f]{64}$ ]] || {
  echo 'kind no registró la imagen GW local cargada.' >&2
  exit 1
}

kubectl --context "${KUBE_CONTEXT}" create namespace "${NAMESPACE}"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create service externalname peer0-host1 \
  --external-name host.docker.internal

GW_SECRET_ENV="${TEMP_DIR}/gw.secret.env"
awk -F= '
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    key=$1
    if (key ~ /^HLF_/ || key ~ /^LEDGER_.*CHAINCODE$/ || key == "CONSENT_ACCESS_LEDGER_CHAINCODE" || key == "FHIR_VERSION_LEDGER_CHAINCODE" || key == "TENANT_SERVICE_ROUTES_JSON" || key == "HOST_LEGACY_REPRESENTATIVE_CONTROLLER") values[key]=$0
  }
  END { for (key in values) print values[key] }
' "${FABRIC_ENV}" > "${GW_SECRET_ENV}"
cat >> "${GW_SECRET_ENV}" <<EOF
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres-local-evidence
POSTGRES_SSL=false
POSTGRES_SCHEMA=public
IPFS_MFS_ROOT=/gwtemplate/blobs
KEK_SECRET=$(openssl rand -base64 32 | tr -d '\n')
FHIR_LEGACY=true
JSON_LEGACY=true
DEMO_ALLOW_INSECURE_BEARER=true
DEV_SEED=true
SMART_TOKEN_LEGACY=true
PAYMENT_VERIFICATION_MODE=mock
EOF
chmod 600 "${GW_SECRET_ENV}"

kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create secret generic host-evidence-gw \
  --from-env-file="${GW_SECRET_ENV}"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create secret generic host-evidence-postgresql \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD=postgres-local-evidence

helm upgrade --install "${RELEASE}" "${ROOT}/charts/gdc-host" \
  --kube-context "${KUBE_CONTEXT}" \
  --namespace "${NAMESPACE}" \
  --values "${ROOT}/charts/gdc-host/ci/local-evidence-values.yaml" \
  --set-string "gw.localImage=${IMAGE_NAME}" \
  --set-string gw.imagePullPolicy=Never \
  --set peer.enabled=false \
  --set-string externalPeer.host=peer0-host1 \
  --set externalPeer.port=7051 \
  --set-string images.init=docker.io/library/busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662 \
  --set-string postgresql.image=docker.io/library/postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685 \
  --set-string ipfs.image=docker.io/ipfs/kubo@sha256:7cc0e0de8f845d6c9fa1dce414c069974c34ed3cd3742e0d4f5bccda4adc376d \
  --wait --timeout 10m

kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "deployment/${RELEASE}-gw" --timeout=5m

LOCAL_PORT="${HELM_EVIDENCE_LOCAL_PORT:-18082}"
BASE_URL="http://127.0.0.1:${LOCAL_PORT}"
start_port_forward() {
  if [[ -n "${PORT_FORWARD_PID}" ]]; then
    kill "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
    wait "${PORT_FORWARD_PID}" >/dev/null 2>&1 || true
  fi
  kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" port-forward \
    "service/${RELEASE}-gw" "${LOCAL_PORT}:80" > "${TEMP_DIR}/port-forward.log" 2>&1 &
  PORT_FORWARD_PID=$!
}
start_port_forward
PING_URL="${BASE_URL}/host/cds-eu/v1/local-network/.well-known/ping"
for _ in $(seq 1 60); do
  curl --fail --silent --max-time 2 "${PING_URL}" >/dev/null 2>&1 && break
  sleep 1
done
curl --fail --silent --show-error --max-time 5 "${PING_URL}" >/dev/null

BASE_URL="${BASE_URL}" TENANT_ID="${EVIDENCE_TENANT_ID}" SUBJECT_ID="${EVIDENCE_SUBJECT_ID}" \
  npx dotenv -e "${FABRIC_ENV}" -- ./scripts/bootstrap-single-tenant.sh
BASE_URL="${BASE_URL}" TENANT_ID="${EVIDENCE_TENANT_ID}" SUBJECT_ID="${EVIDENCE_SUBJECT_ID}" \
  bash ./scripts/smoke-consentaccess-local-network.sh
BASE_URL="${BASE_URL}" TENANT_ID="${EVIDENCE_TENANT_ID}" SUBJECT_ID="${EVIDENCE_SUBJECT_ID}" \
  bash ./scripts/smoke-smart-access-local-network.sh

postgres_pod="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=postgresql -o jsonpath='{.items[0].metadata.name}')"
ipfs_pod="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=ipfs -o jsonpath='{.items[0].metadata.name}')"
postgres_documents="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec "${postgres_pod}" -- \
  psql -U postgres -d gw -Atc 'SELECT count(*) FROM public.vault_documents WHERE deleted_at IS NULL')"
ipfs_blobs="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec "${ipfs_pod}" -- \
  sh -lc 'ipfs files ls /gwtemplate/blobs 2>/dev/null | wc -l | tr -d " "')"
[[ "${postgres_documents}" -gt 0 ]]
[[ "${ipfs_blobs}" -gt 0 ]]

kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout restart "deployment/${RELEASE}-gw"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "deployment/${RELEASE}-gw" --timeout=5m
start_port_forward
for _ in $(seq 1 60); do
  curl --fail --silent --max-time 2 "${PING_URL}" >/dev/null 2>&1 && break
  sleep 1
done
curl --fail --silent --show-error --max-time 5 \
  "${BASE_URL}/${EVIDENCE_TENANT_ID}/cds-ES/v1/health-care/.well-known/did.json" \
  | jq -e '.id | startswith("did:web:")' >/dev/null

echo "Helm local-network validado: postgres_documents=${postgres_documents} ipfs_jwe_blobs=${ipfs_blobs} restart=ok docker_image_id=${docker_image_id} kind_image_id=${kind_image_id}"
