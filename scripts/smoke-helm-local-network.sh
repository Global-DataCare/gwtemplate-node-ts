#!/usr/bin/env bash
# Flujo contractual Helm/Kubernetes para local-network:
# 1. Crea un clúster kind aislado y carga la imagen GW ya validada por Docker.
# 2. Empaqueta y carga los nueve runtimes CCAAS usados por GW CORE.
# 3. Despliega por Helm peer Host1MSP, CouchDB, GW CORE, PostgreSQL, IPFS y CCAAS.
# 4. Enrola una identidad exclusiva para el peer kind y lo une a la Fabric Docker.
# 5. Instala los paquetes CCAAS en el peer kind y actualiza la aprobación Host1MSP.
# 6. Ejecuta el GW contra el peer kind: bootstrap, Consent y SMART positivo/negativo.
# 7. Reinicia GW, peer y CCAAS y demuestra persistencia y nueva capacidad de endoso.
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
FABRIC_DEVNET_ROOT="$(cd "${FABRIC_DEVNET_ROOT:-${ROOT}/infra/fabric/local-network}" && pwd -P)"
KIND_PEER_DOMAIN="peer-kind.host1.example.com"
KIND_PEER_SERVICE="${RELEASE}-peer"
KIND_PEER_DIR="${FABRIC_DEVNET_ROOT}/organizations/peerOrganizations/host1.example.com/peers/${KIND_PEER_DOMAIN}"
HOST1_ADMIN_MSP="${FABRIC_DEVNET_ROOT}/organizations/peerOrganizations/host1.example.com/users/Admin@host1.example.com/msp"
ORDERER_TLS_CA_HOST="${FABRIC_DEVNET_ROOT}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt"
FABRIC_ROOT_CA_CERT="${FABRIC_DEVNET_ROOT}/crypto/ca/root/ca-cert.pem"
FABRIC_ICA_CERT="${FABRIC_DEVNET_ROOT}/crypto/ca/ica/ca-cert.pem"
PREFLIGHT_ONLY=false
TEMP_DIR="$(mktemp -d)"
PORT_FORWARD_PID=""
BUSYBOX_IMAGE='docker.io/library/busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662'
COUCHDB_IMAGE='docker.io/library/couchdb@sha256:307a3f5276f64c0db28f226b7b5c180b8f2c851afa681cfb4fbb1b1fe7fd5587'
POSTGRESQL_IMAGE='docker.io/library/postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
IPFS_IMAGE='docker.io/ipfs/kubo@sha256:7cc0e0de8f845d6c9fa1dce414c069974c34ed3cd3742e0d4f5bccda4adc376d'

# shellcheck source=install-kind-ccaas-chaincodes.sh
source "${ROOT}/scripts/install-kind-ccaas-chaincodes.sh"

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

assert_public_fabric_mounts() {
  local ica_mount peer_mounts
  ica_mount="$(docker inspect gdc-ica --format '{{range .Mounts}}{{if eq .Destination "/etc/hyperledger/fabric-ca-server"}}{{.Source}}{{end}}{{end}}')"
  peer_mounts="$(docker inspect gdc-peer0-host1 --format '{{range .Mounts}}{{println .Source}}{{end}}')"
  if [[ "${ica_mount}" != "${FABRIC_DEVNET_ROOT}/crypto/ca/ica" ]] \
    || [[ "${peer_mounts}" != *"${FABRIC_DEVNET_ROOT}/organizations/"* ]]; then
    echo 'Los contenedores Fabric activos no pertenecen al local-network público de este checkout.' >&2
    echo 'Reconstruya la red con: node scripts/bootstrap-local-fabric-stack.mjs --prepare-only' >&2
    return 1
  fi
}

assert_public_fabric_mounts

normalize_kind_peer_identity() {
  mkdir -p "${KIND_PEER_DIR}/msp/cacerts" "${KIND_PEER_DIR}/msp/intermediatecerts" \
    "${KIND_PEER_DIR}/tls/tlscacerts" "${KIND_PEER_DIR}/tls/tlsintermediatecerts"
  rm -f "${KIND_PEER_DIR}/msp/cacerts/"*.pem "${KIND_PEER_DIR}/msp/intermediatecerts/"*.pem \
    "${KIND_PEER_DIR}/tls/tlscacerts/"*.pem "${KIND_PEER_DIR}/tls/tlsintermediatecerts/"*.pem
  cp -f "${FABRIC_ROOT_CA_CERT}" "${KIND_PEER_DIR}/msp/cacerts/root-ca-cert.pem"
  cp -f "${FABRIC_ICA_CERT}" "${KIND_PEER_DIR}/msp/intermediatecerts/issuer-ca-cert.pem"
  cp -f "${FABRIC_ROOT_CA_CERT}" "${KIND_PEER_DIR}/tls/tlscacerts/root-ca-cert.pem"
  cp -f "${FABRIC_ICA_CERT}" "${KIND_PEER_DIR}/tls/tlsintermediatecerts/issuer-ca-cert.pem"
}

prepare_kind_peer_identity() {
  local enrollment_id="peer-kind-host1-$(openssl rand -hex 6)"
  local enrollment_secret
  enrollment_secret="$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-24)"
  local container_peer_dir="/workspace/organizations/peerOrganizations/host1.example.com/peers/${KIND_PEER_DOMAIN}"
  local ca_tls_cert="/workspace/crypto/ca/ica/ca-tls-bundle.pem"

  test -d "${HOST1_ADMIN_MSP}"
  rm -rf "${KIND_PEER_DIR}"
  mkdir -p "${KIND_PEER_DIR}"

  docker exec \
    -e FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    gdc-fabric-ca-client fabric-ca-client register \
      -u 'https://admin:adminpw@ica:7054' \
      --id.name "${enrollment_id}" \
      --id.secret "${enrollment_secret}" \
      --id.type peer \
      --id.affiliation host1.department1 \
      --id.maxenrollments 2 \
      --tls.certfiles "${ca_tls_cert}" >/dev/null

  docker exec gdc-fabric-ca-client fabric-ca-client enroll \
    -u "https://${enrollment_id}:${enrollment_secret}@ica:7054" \
    -M "${container_peer_dir}/msp" \
    --csr.hosts "${KIND_PEER_SERVICE}" \
    --csr.hosts "${KIND_PEER_DOMAIN}" \
    --tls.certfiles "${ca_tls_cert}" >/dev/null
  cp "${FABRIC_DEVNET_ROOT}/organizations/peerOrganizations/host1.example.com/peers/peer0.host1.example.com/msp/config.yaml" \
    "${KIND_PEER_DIR}/msp/config.yaml"

  docker exec gdc-fabric-ca-client fabric-ca-client enroll \
    -u "https://${enrollment_id}:${enrollment_secret}@ica:7054" \
    -M "${container_peer_dir}/tls" \
    --enrollment.profile tls \
    --csr.hosts "${KIND_PEER_SERVICE}" \
    --csr.hosts "${KIND_PEER_DOMAIN}" \
    --tls.certfiles "${ca_tls_cert}" >/dev/null

  normalize_kind_peer_identity
  COPYFILE_DISABLE=1 tar -C "${KIND_PEER_DIR}/msp" -czf "${TEMP_DIR}/peer-msp.tgz" .
  COPYFILE_DISABLE=1 tar -C "${KIND_PEER_DIR}/tls" -czf "${TEMP_DIR}/peer-tls.tgz" .
}

prepare_kind_peer_identity

GW_IMAGE_ARCHIVE="${TEMP_DIR}/gw-image.tar"
HOST_RUNTIME_IMAGE_ARCHIVE="${TEMP_DIR}/host-runtime-images.tar"
PUBLIC_DOCKER_CONFIG="${TEMP_DIR}/docker-public"
peer_image_tag="$(docker inspect gdc-peer0-host1 --format '{{.Config.Image}}')"
peer_image="$(docker image inspect "${peer_image_tag}" --format '{{index .RepoDigests 0}}')"
tools_image="$(docker inspect gdc-fabric-tools --format '{{.Config.Image}}')"
# Keep at most one digest-only image in this archive. kind assigns the same
# synthetic import name to untagged Docker archives; combining several can
# overwrite their manifest reference. BusyBox and PostgreSQL are small and are
# therefore resolved directly by their immutable digest inside the cluster.
host_runtime_images=(
  "${COUCHDB_IMAGE}"
  "${IPFS_IMAGE}"
  "${peer_image_tag}"
  "${tools_image}"
)
mkdir -p "${PUBLIC_DOCKER_CONFIG}"
for runtime_image in "${host_runtime_images[@]}"; do
  if ! docker image inspect "${runtime_image}" >/dev/null 2>&1; then
    DOCKER_CONFIG="${PUBLIC_DOCKER_CONFIG}" docker pull "${runtime_image}"
  fi
done
docker save --output "${GW_IMAGE_ARCHIVE}" "${IMAGE_NAME}"
docker save --output "${HOST_RUNTIME_IMAGE_ARCHIVE}" "${host_runtime_images[@]}"
kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
kind create cluster --name "${CLUSTER_NAME}" --wait 90s
kind load image-archive "${GW_IMAGE_ARCHIVE}" --name "${CLUSTER_NAME}"
kind load image-archive "${HOST_RUNTIME_IMAGE_ARCHIVE}" --name "${CLUSTER_NAME}"
prepare_kind_ccaas_chaincodes

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
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create service externalname orderer \
  --external-name host.docker.internal
# El peer nuevo necesita descubrir al menos un peer ya miembro para sincronizar
# los bloques históricos. Esta ruta es solo de gossip/bootstrap: ni GW CORE ni
# las consultas de evidencia la utilizan para endosar o leer transacciones.
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
CONFIDENTIAL_JWE_INLINE_MAX_BYTES=1
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
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create secret generic host-evidence-peer-msp \
  --from-file=msp.tgz="${TEMP_DIR}/peer-msp.tgz"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create secret generic host-evidence-peer-tls \
  --from-file=tls.tgz="${TEMP_DIR}/peer-tls.tgz"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create secret generic host-evidence-couchdb \
  --from-literal=username=admin \
  --from-literal=password=couchdb-local-evidence
printf '%s\n' '{"authorized":true,"mspId":"Host1MSP","networkKind":"local-network","hostCredentialId":"local-evidence-host-credential"}' \
  > "${TEMP_DIR}/authorization.json"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" create secret generic host-evidence-authorization \
  --from-file=authorization.json="${TEMP_DIR}/authorization.json"

helm upgrade --install "${RELEASE}" "${ROOT}/charts/gdc-host" \
  --kube-context "${KUBE_CONTEXT}" \
  --namespace "${NAMESPACE}" \
  --values "${ROOT}/charts/gdc-host/ci/local-evidence-values.yaml" \
  --values "${KIND_CCAAS_VALUES_FILE}" \
  --set gw.enabled=false \
  --set-string "gw.localImage=${IMAGE_NAME}" \
  --set-string gw.imagePullPolicy=Never \
  --set-string gw.fabricPeerEndpoint="${KIND_PEER_SERVICE}:7051" \
  --set peer.enabled=true \
  --set-string peer.image="${peer_image}" \
  --set-string peer.name=peer-kind-host1 \
  --set-string peer.mspId=Host1MSP \
  --set-string peer.externalEndpoint="${KIND_PEER_SERVICE}:7051" \
  --set-string peer.bootstrap=peer0-host1:7051 \
  --set-string peer.mspSecretName=host-evidence-peer-msp \
  --set-string peer.tlsSecretName=host-evidence-peer-tls \
  --set-string peer.couchdbSecretName=host-evidence-couchdb \
  --set-string peer.service.type=ClusterIP \
  --set-string authorization.existingSecret=host-evidence-authorization \
  --set-string externalPeer.host=peer0-host1 \
  --set externalPeer.port=7051 \
  --set-string images.init="${BUSYBOX_IMAGE}" \
  --set-string couchdb.image="${COUCHDB_IMAGE}" \
  --set-string postgresql.image="${POSTGRESQL_IMAGE}" \
  --set-string ipfs.image="${IPFS_IMAGE}" \
  --wait --timeout 10m

kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "statefulset/${RELEASE}-peer" --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "statefulset/${RELEASE}-couchdb" --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  deployment --selector app.kubernetes.io/component=chaincode --timeout=5m

kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" run peer-join-tools \
  --image="${tools_image}" \
  --image-pull-policy=Never \
  --restart=Never \
  --command -- sleep 900
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" wait \
  --for=condition=Ready pod/peer-join-tools --timeout=3m
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" cp \
  "${HOST1_ADMIN_MSP}/." peer-join-tools:/tmp/admin-msp
kind_peer_tls_bundle="${TEMP_DIR}/peer-tls-ca-bundle.pem"
find "${KIND_PEER_DIR}/tls/tlscacerts" "${KIND_PEER_DIR}/tls/tlsintermediatecerts" \
  -type f -name '*.pem' -exec cat {} + > "${kind_peer_tls_bundle}"
test -s "${kind_peer_tls_bundle}"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" cp \
  "${kind_peer_tls_bundle}" peer-join-tools:/tmp/peer-tls-root.pem
for _ in $(seq 1 60); do
  if kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
    CORE_PEER_LOCALMSPID=Host1MSP \
    CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
    CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
    CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
    peer node status >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
  CORE_PEER_LOCALMSPID=Host1MSP \
  CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
  CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
  CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
  peer node status >/dev/null

wait_for_kind_peer_sync() {
  local channel="$1"
  local network_height=0 kind_height=0
  for _ in $(seq 1 120); do
    network_height="$(docker exec gdc-fabric-tools env \
      CORE_PEER_LOCALMSPID=Host1MSP \
      CORE_PEER_MSPCONFIGPATH=/workspace/organizations/peerOrganizations/host1.example.com/users/Admin@host1.example.com/msp \
      CORE_PEER_ADDRESS=peer0-host1:7051 \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE=/workspace/organizations/peerOrganizations/host1.example.com/peers/peer0.host1.example.com/tls/ca.crt \
      peer channel getinfo -c "${channel}" 2>/dev/null \
      | sed 's/^Blockchain info: //' | jq -r '.height')"
    kind_height="$(kind_peer_exec peer channel getinfo -c "${channel}" 2>/dev/null \
      | sed 's/^Blockchain info: //' | jq -r '.height')"
    if [[ "${network_height}" -ge 1 && "${kind_height}" == "${network_height}" ]]; then
      echo "Peer Kubernetes sincronizado: channel=${channel} height=${kind_height}"
      return 0
    fi
    sleep 1
  done
  echo "El peer Kubernetes no sincronizó ${channel}: kind=${kind_height} network=${network_height}" >&2
  return 1
}

for channel in identity-local health-care-local; do
  kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" cp \
    "${FABRIC_DEVNET_ROOT}/channel-artifacts/${channel}.block" \
    "peer-join-tools:/tmp/${channel}.block"
  kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
    CORE_PEER_LOCALMSPID=Host1MSP \
    CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
    CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
    CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
    peer channel join -b "/tmp/${channel}.block"
done
kind_peer_channels="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
  CORE_PEER_LOCALMSPID=Host1MSP \
  CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
  CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
  CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
  peer channel list)"
for channel in identity-local health-care-local; do
  grep -qx "${channel}" <<< "${kind_peer_channels}"
  kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
    CORE_PEER_LOCALMSPID=Host1MSP \
    CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
    CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
    CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
    peer channel getinfo -c "${channel}" | grep -Eq 'height[^0-9]*[1-9][0-9]*'
  wait_for_kind_peer_sync "${channel}"
done
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=peer -o jsonpath='{.items[0].spec.containers[0].env}' \
  | grep -Fq 'CORE_PEER_LOCALMSPID'
couchdb_pod="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=couchdb -o jsonpath='{.items[0].metadata.name}')"
for _ in $(seq 1 60); do
  couchdb_databases="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec "${couchdb_pod}" -- \
    curl --fail --silent --user admin:couchdb-local-evidence http://127.0.0.1:5984/_all_dbs 2>/dev/null || true)"
  if grep -Fq 'identity-local' <<< "${couchdb_databases}" \
    && grep -Fq 'health-care-local' <<< "${couchdb_databases}"; then
    break
  fi
  sleep 1
done
grep -Fq 'identity-local' <<< "${couchdb_databases}"
grep -Fq 'health-care-local' <<< "${couchdb_databases}"

install_kind_ccaas_chaincodes
verify_kind_ccaas_readiness
helm upgrade "${RELEASE}" "${ROOT}/charts/gdc-host" \
  --kube-context "${KUBE_CONTEXT}" \
  --namespace "${NAMESPACE}" \
  --reuse-values \
  --set gw.enabled=true \
  --wait --timeout 10m
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "deployment/${RELEASE}-gw" --timeout=5m
gw_pod="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=gw -o jsonpath='{.items[0].metadata.name}')"
gw_fabric_peer="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec "${gw_pod}" -- \
  printenv HLF_CONNECTION_PEER)"
[[ "${gw_fabric_peer}" == "${KIND_PEER_SERVICE}:7051" ]] || {
  echo "El GW no apunta al peer Kubernetes: ${gw_fabric_peer}" >&2
  exit 1
}
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
  FABRIC_QUERY_MODE=kubectl FABRIC_KUBE_CONTEXT="${KUBE_CONTEXT}" \
  FABRIC_KUBE_NAMESPACE="${NAMESPACE}" FABRIC_KUBE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
  FABRIC_KUBE_SERVER_HOST_OVERRIDE="${KIND_PEER_SERVICE}" \
  bash ./scripts/smoke-consentaccess-local-network.sh
BASE_URL="${BASE_URL}" TENANT_ID="${EVIDENCE_TENANT_ID}" SUBJECT_ID="${EVIDENCE_SUBJECT_ID}" \
  FABRIC_QUERY_MODE=kubectl FABRIC_KUBE_CONTEXT="${KUBE_CONTEXT}" \
  FABRIC_KUBE_NAMESPACE="${NAMESPACE}" FABRIC_KUBE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
  FABRIC_KUBE_SERVER_HOST_OVERRIDE="${KIND_PEER_SERVICE}" \
  bash ./scripts/smoke-smart-access-local-network.sh

postgres_pod="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=postgresql -o jsonpath='{.items[0].metadata.name}')"
ipfs_pod="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" get pod \
  -l app.kubernetes.io/component=ipfs -o jsonpath='{.items[0].metadata.name}')"
postgres_documents="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec "${postgres_pod}" -- \
  psql -U postgres -d gw -Atc 'SELECT count(*) FROM public.vault_documents WHERE deleted_at IS NULL')"
ipfs_blobs="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec "${ipfs_pod}" -- \
  sh -lc 'ipfs files ls /gwtemplate/blobs 2>/dev/null | wc -l | tr -d " "')"
if [[ "${postgres_documents}" -le 0 ]]; then
  echo 'La prueba Helm no persistió ningún documento cifrado en PostgreSQL.' >&2
  exit 1
fi
if [[ "${ipfs_blobs}" -le 0 ]]; then
  echo 'La prueba Helm no persistió ningún JWE cifrado en IPFS.' >&2
  exit 1
fi

kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout restart "deployment/${RELEASE}-gw"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout restart "statefulset/${RELEASE}-peer"
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout restart \
  deployment --selector app.kubernetes.io/component=chaincode
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "deployment/${RELEASE}-gw" --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  "statefulset/${RELEASE}-peer" --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" rollout status \
  deployment --selector app.kubernetes.io/component=chaincode --timeout=5m
verify_kind_ccaas_readiness
start_port_forward
for _ in $(seq 1 60); do
  curl --fail --silent --max-time 2 "${PING_URL}" >/dev/null 2>&1 && break
  sleep 1
done
curl --fail --silent --show-error --max-time 5 \
  "${BASE_URL}/${EVIDENCE_TENANT_ID}/cds-ES/v1/health-care/.well-known/did.json" \
  | jq -e '.id | startswith("did:web:")' >/dev/null
kind_peer_channels="$(kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
  CORE_PEER_LOCALMSPID=Host1MSP \
  CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
  CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
  CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
  peer channel list)"
for channel in identity-local health-care-local; do
  grep -qx "${channel}" <<< "${kind_peer_channels}"
done

echo "Helm local-network validado: kind_peer_msp=Host1MSP kind_peer_channels=$(tr '\n' ',' <<< "${kind_peer_channels}" | sed 's/,$//') kind_peer_ccaas=${KIND_PEER_CCAAS_NAMES} gw_fabric_peer=${gw_fabric_peer} couchdb_channels=ok postgres_documents=${postgres_documents} ipfs_jwe_blobs=${ipfs_blobs} gw_peer_ccaas_restart=ok docker_image_id=${docker_image_id} kind_image_id=${kind_image_id}"
