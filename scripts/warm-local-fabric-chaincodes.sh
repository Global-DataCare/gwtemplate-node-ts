#!/usr/bin/env bash
set -euo pipefail

# Fabric starts ordinary Node chaincode containers lazily on their first
# proposal. A fresh devnet can otherwise race GW host bootstrap: the first
# ledger call starts one contract while the next contract still has no
# endorsing process. This probe forces every identity contract through that
# launch boundary before the GW image is started.

FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
CHANNEL_NAME="${IDENTITY_CHANNEL_NAME:-identity-local}"
HOST_MSP_ID="${HOST_MSP_ID:-Host1MSP}"
HOST_DOMAIN="${HOST_DOMAIN:-host1.example.com}"
PEER_ADDRESS="${PEER_ADDRESS:-peer0-host1:7051}"
READINESS_FUNCTION="${READINESS_FUNCTION:-__readiness_probe__}"
CHAINCODES=(
  organization-sc
  cryptographickey-sc
  employee-sc
  evidence-sc
  credential-sc
  artifact-sc
  artifactevent-sc
  subjectkeybinding-sc
)

for chaincode in "${CHAINCODES[@]}"; do
  set +e
  output="$(docker exec \
    -e CORE_PEER_LOCALMSPID="${HOST_MSP_ID}" \
    -e CORE_PEER_MSPCONFIGPATH="/workspace/organizations/peerOrganizations/${HOST_DOMAIN}/users/Admin@${HOST_DOMAIN}/msp" \
    -e CORE_PEER_ADDRESS="${PEER_ADDRESS}" \
    -e CORE_PEER_TLS_ENABLED=true \
    -e CORE_PEER_TLS_ROOTCERT_FILE="/workspace/organizations/peerOrganizations/${HOST_DOMAIN}/peers/peer0.${HOST_DOMAIN}/tls/ca.crt" \
    "${FABRIC_TOOLS_CONTAINER}" \
    peer chaincode query \
      -C "${CHANNEL_NAME}" \
      -n "${chaincode}" \
      -c "{\"Args\":[\"${READINESS_FUNCTION}\"]}" 2>&1)"
  status=$?
  set -e

  if [[ ${status} -ne 0 ]] \
    && [[ "${output}" != *"function that does not exist: ${READINESS_FUNCTION}"* ]]; then
    echo "ERROR: ${chaincode} did not cross the local Fabric launch boundary" >&2
    echo "${output}" >&2
    exit 1
  fi
  echo "[local-fabric-chaincode-readiness] ${chaincode}: ready"
done
