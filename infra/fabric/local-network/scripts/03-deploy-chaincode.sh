#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

GWTEMPLATE_DIR="${GWTEMPLATE_DIR:-$(cd "${ROOT}/../../.." && pwd)}"

CHANNEL_NAME="${CHANNEL_NAME:-${HLF_DATA_CHANNEL_NAME:-${HLF_CHANNEL_NAME:-health-care-local}}}"
SINGLE_HOST="${SINGLE_HOST:-true}"

CHAINCODE_NAME="${CHAINCODE_NAME:-basic}"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_LABEL="${CHAINCODE_LABEL:-${CHAINCODE_NAME}_${CHAINCODE_VERSION}}"
CHAINCODE_PATH="${CHAINCODE_PATH:-${GWTEMPLATE_DIR}/chaincode/basic}"
CHAINCODE_LANG="${CHAINCODE_LANG:-node}"
SKIP_CHAINCODE_INSTALL="${SKIP_CHAINCODE_INSTALL:-false}"
CHAINCODE_STAGING_ROOT="${ROOT}/external-chaincodes"
# A one-peer local devnet must not inherit a channel policy that requires an
# endorsement from an absent organization. Multi-host callers can override or
# clear this policy explicitly.
if [[ "${SINGLE_HOST}" == "true" ]]; then
  CHAINCODE_SIGNATURE_POLICY="${CHAINCODE_SIGNATURE_POLICY:-OR('Host1MSP.member')}"
else
  CHAINCODE_SIGNATURE_POLICY="${CHAINCODE_SIGNATURE_POLICY:-}"
fi
CHAINCODE_POLICY_ARGS=()
if [[ -n "${CHAINCODE_SIGNATURE_POLICY}" ]]; then
  CHAINCODE_POLICY_ARGS=(--signature-policy "${CHAINCODE_SIGNATURE_POLICY}")
fi

HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"
HOST2_DOMAIN="${HOST2_DOMAIN:-host2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"
HOST1_MSP_ID="${HLF_MSP_ID_HOST1:-Host1MSP}"
HOST2_MSP_ID="${HLF_MSP_ID_HOST2:-Host2MSP}"

ORDERER_TLS_CA="/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt"

function exec_tools() {
  docker exec -w /workspace "${FABRIC_TOOLS_CONTAINER:-${GDC_CONTAINER_PREFIX:-gdc}-fabric-tools}" "$@"
}

function stage_chaincode_path() {
  local source_path="$1"
  if [[ -z "${source_path}" ]]; then
    echo "Missing CHAINCODE_PATH"
    exit 1
  fi

  if [[ "${source_path}" == "${ROOT}"/* ]]; then
    echo "${source_path#${ROOT}/}"
    return 0
  fi

  if [[ ! -d "${source_path}" ]]; then
    echo "Missing chaincode directory: ${source_path}"
    exit 1
  fi

  local staged_rel="external-chaincodes/${CHAINCODE_NAME}"
  local staged_abs="${ROOT}/${staged_rel}"
  rm -rf "${staged_abs}"
  mkdir -p "${CHAINCODE_STAGING_ROOT}"
  cp -R "${source_path}" "${staged_abs}"
  echo "${staged_rel}"
}

if [[ ! -f "channel-artifacts/${CHANNEL_NAME}.block" ]]; then
  echo "Missing channel block. Run ./scripts/02-bootstrap-network.sh first."
  exit 1
fi

PACKAGE_FILE="/workspace/channel-artifacts/${CHAINCODE_LABEL}.tgz"

install_on_peer() {
  local msp="$1"
  local peer_addr="$2"
  local msp_path="$3"
  local peer_tls_root="$4"

  exec_tools \
    env CORE_PEER_LOCALMSPID="${msp}" \
    CORE_PEER_ADDRESS="${peer_addr}" \
    CORE_PEER_MSPCONFIGPATH="${msp_path}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${peer_tls_root}" \
    peer lifecycle chaincode install "${PACKAGE_FILE}"
}

HOST1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"
HOST2_ADMIN_MSP="/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp"

HOST1_PEER_TLS="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"
HOST2_PEER_TLS="/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt"

if [[ "${SKIP_CHAINCODE_INSTALL}" != "true" ]]; then
  STAGED_CHAINCODE_PATH="$(stage_chaincode_path "${CHAINCODE_PATH}")"
  echo "Packaging chaincode ${CHAINCODE_NAME} from ${CHAINCODE_PATH}..."
  exec_tools \
    peer lifecycle chaincode package "${PACKAGE_FILE}" \
    --path "/workspace/${STAGED_CHAINCODE_PATH}" \
    --lang "${CHAINCODE_LANG}" \
    --label "${CHAINCODE_LABEL}"

  echo "Installing on Host1 peer..."
  install_on_peer "${HOST1_MSP_ID}" "peer0-host1:7051" "${HOST1_ADMIN_MSP}" "${HOST1_PEER_TLS}"

  if [[ "${SINGLE_HOST}" != "true" ]]; then
    echo "Installing on Host2 peer..."
    install_on_peer "${HOST2_MSP_ID}" "peer0-host2:7051" "${HOST2_ADMIN_MSP}" "${HOST2_PEER_TLS}"
  fi
else
  echo "Reusing installed package ${CHAINCODE_LABEL} for channel ${CHANNEL_NAME}..."
fi

PACKAGE_ID="$(
  exec_tools \
    env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
    peer lifecycle chaincode queryinstalled | \
    awk -v label="${CHAINCODE_LABEL}" '$0 ~ label {gsub(/,/, "", $3); print $3}' | head -n 1
)"

if [[ -z "${PACKAGE_ID}" ]]; then
  echo "Could not resolve PACKAGE_ID for label ${CHAINCODE_LABEL}"
  exit 1
fi

echo "Approving for Host1..."
exec_tools \
  env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
  CORE_PEER_ADDRESS="peer0-host1:7051" \
  CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
  peer lifecycle chaincode approveformyorg \
  -o orderer:7050 \
  --ordererTLSHostnameOverride orderer \
  --tls --cafile "${ORDERER_TLS_CA}" \
  --channelID "${CHANNEL_NAME}" \
  --name "${CHAINCODE_NAME}" \
  --version "${CHAINCODE_VERSION}" \
  --package-id "${PACKAGE_ID}" \
  --sequence "${CHAINCODE_SEQUENCE}" \
  "${CHAINCODE_POLICY_ARGS[@]}"

echo "Approving for Host2..."
if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_tools \
    env CORE_PEER_LOCALMSPID="${HOST2_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host2:7051" \
    CORE_PEER_MSPCONFIGPATH="${HOST2_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${HOST2_PEER_TLS}" \
    peer lifecycle chaincode approveformyorg \
    -o orderer:7050 \
    --ordererTLSHostnameOverride orderer \
    --tls --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --package-id "${PACKAGE_ID}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    "${CHAINCODE_POLICY_ARGS[@]}"
fi

echo "Committing chaincode definition..."
if [[ "${SINGLE_HOST}" == "true" ]]; then
  exec_tools \
    env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
    peer lifecycle chaincode commit \
    -o orderer:7050 \
    --ordererTLSHostnameOverride orderer \
    --tls --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    "${CHAINCODE_POLICY_ARGS[@]}" \
    --peerAddresses peer0-host1:7051 --tlsRootCertFiles "${HOST1_PEER_TLS}"
else
  exec_tools \
    env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
    peer lifecycle chaincode commit \
    -o orderer:7050 \
    --ordererTLSHostnameOverride orderer \
    --tls --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    "${CHAINCODE_POLICY_ARGS[@]}" \
    --peerAddresses peer0-host1:7051 --tlsRootCertFiles "${HOST1_PEER_TLS}" \
    --peerAddresses peer0-host2:7051 --tlsRootCertFiles "${HOST2_PEER_TLS}"
fi

echo "✅ Chaincode deployed: ${CHAINCODE_NAME} on ${CHANNEL_NAME}"
