#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "${ROOT}/../../.." && pwd)"
DATASPACE_CA_ROOT="${DATASPACE_CA_ROOT:-${REPO_ROOT}/../dataspace-ca-ts}"

CA_DOMAIN="${CA_DOMAIN:-ca.local.example.org}"
CA_PROFILE="${CA_PROFILE:-staging}"
CA_COUNTRY="${CA_COUNTRY:-ES}"
CA_JURISDICTION="${CA_JURISDICTION:-ES}"
CA_SECTOR="${CA_SECTOR:-health-care}"

ROOT_PASSPHRASE="${ROOT_PASSPHRASE:-}"
ISSUER_PASSPHRASE="${ISSUER_PASSPHRASE:-}"
ROOT_PASSPHRASE_ENV="${ROOT_PASSPHRASE_ENV:-ROOT_PASSPHRASE}"
ISSUER_PASSPHRASE_ENV="${ISSUER_PASSPHRASE_ENV:-ISSUER_PASSPHRASE}"

RUN_UP_CAS="${RUN_UP_CAS:-true}"
RUN_BOOTSTRAP_NETWORK="${RUN_BOOTSTRAP_NETWORK:-true}"

function require_nonempty_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "${value}" ]]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

if [[ ! -d "${DATASPACE_CA_ROOT}" ]]; then
  echo "dataspace-ca-ts not found at ${DATASPACE_CA_ROOT}" >&2
  exit 1
fi

require_nonempty_env "${ROOT_PASSPHRASE_ENV}"
require_nonempty_env "${ISSUER_PASSPHRASE_ENV}"

ROOT_OUTPUT_DIR="${ROOT_OUTPUT_DIR:-${DATASPACE_CA_ROOT}/output/dataspace-ca/root}"
ISSUER_OUTPUT_DIR="${ISSUER_OUTPUT_DIR:-${DATASPACE_CA_ROOT}/output/dataspace-ca/issuer}"

echo "==> Bootstrapping dataspace root CA"
(
  cd "${DATASPACE_CA_ROOT}"
  node ./bin/dataspace-ca-cli.js root:bootstrap \
    --domain "${CA_DOMAIN}" \
    --profile "${CA_PROFILE}" \
    --country "${CA_COUNTRY}" \
    --passphrase-env "${ROOT_PASSPHRASE_ENV}" \
    --out-dir "${ROOT_OUTPUT_DIR}"
)

echo "==> Bootstrapping dataspace issuer CA"
(
  cd "${DATASPACE_CA_ROOT}"
  node ./bin/dataspace-ca-cli.js issuer:bootstrap \
    --domain "${CA_DOMAIN}" \
    --root-dir "${ROOT_OUTPUT_DIR}" \
    --profile "${CA_PROFILE}" \
    --country "${CA_COUNTRY}" \
    --jurisdiction "${CA_JURISDICTION}" \
    --sector "${CA_SECTOR}" \
    --passphrase-env "${ISSUER_PASSPHRASE_ENV}" \
    --out-dir "${ISSUER_OUTPUT_DIR}"
)

echo "==> Copying dataspace CA material into Fabric devnet"
"${ROOT}/scripts/00-copy-dataspace-ca.sh" "${ROOT_OUTPUT_DIR}" "${ISSUER_OUTPUT_DIR}"

if [[ "${RUN_UP_CAS}" == "true" ]]; then
  echo "==> Starting Fabric CAs in Docker"
  "${ROOT}/scripts/01-up-cas.sh"
fi

if [[ "${RUN_BOOTSTRAP_NETWORK}" == "true" ]]; then
  echo "==> Bootstrapping local Fabric network"
  "${ROOT}/scripts/02-bootstrap-network.sh"
fi

echo
echo "Completed local Fabric bootstrap from dataspace-ca-ts."
echo "- dataspace-ca root output:   ${ROOT_OUTPUT_DIR}"
echo "- dataspace-ca issuer output: ${ISSUER_OUTPUT_DIR}"
echo "- Fabric devnet root CA:      ${ROOT}/crypto/ca/root"
echo "- Fabric devnet ICA:          ${ROOT}/crypto/ca/ica"
