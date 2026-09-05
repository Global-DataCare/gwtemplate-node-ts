#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

GWTEMPLATE_DIR="${GWTEMPLATE_DIR:-$(cd "${ROOT}/../../.." && pwd)}"
IDENTITY_CHANNEL_NAME="${HLF_IDENTITY_CHANNEL_NAME:-identity-local}"
DATA_CHANNEL_NAME="${HLF_DATA_CHANNEL_NAME:-${HLF_CHANNEL_NAME:-health-care-local}}"
CHANNEL_NAME="${CHANNEL_NAME:-${IDENTITY_CHANNEL_NAME}}"

CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"

DEPLOY_SCRIPT="${ROOT}/scripts/03-deploy-chaincode.sh"

if [[ ! -f "${DEPLOY_SCRIPT}" ]]; then
  echo "Missing deploy script at ${DEPLOY_SCRIPT}" >&2
  exit 1
fi

function deploy_chaincode() {
  local name="$1"
  local path="$2"
  local channel="${3:-${CHANNEL_NAME}}"
  local skip_install="${4:-false}"
  local label="${name}_${CHAINCODE_VERSION}"

  echo "---> Deploying ${name} from ${path} on ${channel}"
  CHANNEL_NAME="${channel}" \
  CHAINCODE_NAME="${name}" \
  CHAINCODE_PATH="${path}" \
  CHAINCODE_LABEL="${label}" \
  CHAINCODE_VERSION="${CHAINCODE_VERSION}" \
  CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE}" \
  SKIP_CHAINCODE_INSTALL="${skip_install}" \
  bash "${DEPLOY_SCRIPT}"
}

deploy_chaincode "organization-sc" "${GWTEMPLATE_DIR}/chaincode/organization-sc-javascript"
deploy_chaincode "cryptographickey-sc" "${GWTEMPLATE_DIR}/chaincode/cryptographickey-sc-javascript"
deploy_chaincode "employee-sc" "${GWTEMPLATE_DIR}/chaincode/employee-sc-javascript"
deploy_chaincode "evidence-sc" "${GWTEMPLATE_DIR}/chaincode/evidence-sc-javascript"
deploy_chaincode "credential-sc" "${GWTEMPLATE_DIR}/chaincode/credential-sc-javascript"
deploy_chaincode "artifact-sc" "${GWTEMPLATE_DIR}/chaincode/artifact-sc-javascript"
deploy_chaincode "artifact-sc" "${GWTEMPLATE_DIR}/chaincode/artifact-sc-javascript" "${DATA_CHANNEL_NAME}" true
deploy_chaincode "artifactevent-sc" "${GWTEMPLATE_DIR}/chaincode/artifactevent-sc-javascript"
deploy_chaincode "subjectkeybinding-sc" "${GWTEMPLATE_DIR}/chaincode/subjectkeybinding-sc-javascript"
echo "Identity chaincodes deployed on ${CHANNEL_NAME}"
