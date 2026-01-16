#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

CHANNEL_NAME="${HLF_CHANNEL_NAME:-mychannel}"
SINGLE_HOST="${SINGLE_HOST:-true}"

CHAINCODE_NAME="${CHAINCODE_NAME:-basic}"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_LABEL="${CHAINCODE_LABEL:-${CHAINCODE_NAME}_${CHAINCODE_VERSION}}"
CHAINCODE_PATH="${CHAINCODE_PATH:-../chaincode/basic}"
CHAINCODE_LANG="${CHAINCODE_LANG:-node}"

ORG1_DOMAIN="${ORG1_DOMAIN:-org1.example.com}"
ORG2_DOMAIN="${ORG2_DOMAIN:-org2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"

ORDERER_TLS_CA="/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt"

function exec_tools() {
  docker exec -w /workspace gdc-fabric-tools "$@"
}

if [[ ! -f "channel-artifacts/${CHANNEL_NAME}.block" ]]; then
  echo "Missing channel block. Run ./scripts/02-bootstrap-network.sh first."
  exit 1
fi

PACKAGE_FILE="/workspace/channel-artifacts/${CHAINCODE_LABEL}.tgz"

echo "Packaging chaincode ${CHAINCODE_NAME} from ${CHAINCODE_PATH}..."
exec_tools \
  peer lifecycle chaincode package "${PACKAGE_FILE}" \
  --path "/workspace/${CHAINCODE_PATH}" \
  --lang "${CHAINCODE_LANG}" \
  --label "${CHAINCODE_LABEL}"

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

ORG1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp"
ORG2_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/users/Admin@${ORG2_DOMAIN}/msp"

ORG1_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"
ORG2_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}/tls/ca.crt"

echo "Installing on Org1 peer..."
install_on_peer "Org1MSP" "peer0-org1:7051" "${ORG1_ADMIN_MSP}" "${ORG1_PEER_TLS}"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  echo "Installing on Org2 peer..."
  install_on_peer "Org2MSP" "peer0-org2:7051" "${ORG2_ADMIN_MSP}" "${ORG2_PEER_TLS}"
fi

PACKAGE_ID="$(
  exec_tools \
    env CORE_PEER_LOCALMSPID="Org1MSP" \
    CORE_PEER_ADDRESS="peer0-org1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode queryinstalled | \
    awk -v label="${CHAINCODE_LABEL}" '$0 ~ label {gsub(/,/, "", $3); print $3}' | head -n 1
)"

if [[ -z "${PACKAGE_ID}" ]]; then
  echo "Could not resolve PACKAGE_ID for label ${CHAINCODE_LABEL}"
  exit 1
fi

echo "Approving for Org1..."
exec_tools \
  env CORE_PEER_LOCALMSPID="Org1MSP" \
  CORE_PEER_ADDRESS="peer0-org1:7051" \
  CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
  peer lifecycle chaincode approveformyorg \
  -o orderer:7050 \
  --ordererTLSHostnameOverride orderer \
  --tls --cafile "${ORDERER_TLS_CA}" \
  --channelID "${CHANNEL_NAME}" \
  --name "${CHAINCODE_NAME}" \
  --version "${CHAINCODE_VERSION}" \
  --package-id "${PACKAGE_ID}" \
  --sequence "${CHAINCODE_SEQUENCE}"

echo "Approving for Org2..."
if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_tools \
    env CORE_PEER_LOCALMSPID="Org2MSP" \
    CORE_PEER_ADDRESS="peer0-org2:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG2_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG2_PEER_TLS}" \
    peer lifecycle chaincode approveformyorg \
    -o orderer:7050 \
    --ordererTLSHostnameOverride orderer \
    --tls --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --package-id "${PACKAGE_ID}" \
    --sequence "${CHAINCODE_SEQUENCE}"
fi

echo "Committing chaincode definition..."
if [[ "${SINGLE_HOST}" == "true" ]]; then
  exec_tools \
    env CORE_PEER_LOCALMSPID="Org1MSP" \
    CORE_PEER_ADDRESS="peer0-org1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode commit \
    -o orderer:7050 \
    --ordererTLSHostnameOverride orderer \
    --tls --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    --peerAddresses peer0-org1:7051 --tlsRootCertFiles "${ORG1_PEER_TLS}"
else
  exec_tools \
    env CORE_PEER_LOCALMSPID="Org1MSP" \
    CORE_PEER_ADDRESS="peer0-org1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode commit \
    -o orderer:7050 \
    --ordererTLSHostnameOverride orderer \
    --tls --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    --peerAddresses peer0-org1:7051 --tlsRootCertFiles "${ORG1_PEER_TLS}" \
    --peerAddresses peer0-org2:7051 --tlsRootCertFiles "${ORG2_PEER_TLS}"
fi

echo "✅ Chaincode deployed: ${CHAINCODE_NAME} on ${CHANNEL_NAME}"
