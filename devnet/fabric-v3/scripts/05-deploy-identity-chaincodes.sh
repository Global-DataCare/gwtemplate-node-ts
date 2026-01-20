#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"

DEPLOY_SCRIPT="${ROOT}/scripts/03-deploy-chaincode.sh"

if [[ ! -x "${DEPLOY_SCRIPT}" ]]; then
  echo "Missing deploy script at ${DEPLOY_SCRIPT}" >&2
  exit 1
fi

function deploy_chaincode() {
  local name="$1"
  local path="$2"
  local label="${name}_${CHAINCODE_VERSION}"

  echo "---> Deploying ${name} from ${path}"
  CHAINCODE_NAME="${name}" \
  CHAINCODE_PATH="${path}" \
  CHAINCODE_LABEL="${label}" \
  CHAINCODE_VERSION="${CHAINCODE_VERSION}" \
  CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE}" \
  "${DEPLOY_SCRIPT}"
}

deploy_chaincode "organization-sc" "../chaincode/organization-sc-javascript"
deploy_chaincode "cryptographickey-sc" "../chaincode/cryptographickey-sc-javascript"
deploy_chaincode "employee-sc" "../chaincode/employee-sc-javascript"
deploy_chaincode "evidence-sc" "../chaincode/evidence-sc-javascript"
deploy_chaincode "credential-sc" "../chaincode/credential-sc-javascript"

echo "Identity chaincodes deployed"
