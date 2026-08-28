#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

REPO_ROOT="$(cd "${ROOT}/../../.." && pwd)"
SRC_ROOT_DIR="${1:-${DATASPACE_CA_ROOT_DIR:-${REPO_ROOT}/../dataspace-ca-ts/output/dataspace-ca/root}}"
SRC_ISSUER_DIR="${2:-${DATASPACE_CA_ISSUER_DIR:-${REPO_ROOT}/../dataspace-ca-ts/output/dataspace-ca/issuer}}"

DST_ROOT_CA="${ROOT}/crypto/ca/root"
DST_ICA="${ROOT}/crypto/ca/ica"

ROOT_KEY="${SRC_ROOT_DIR}/root-key.pem"
ROOT_CERT="${SRC_ROOT_DIR}/root-cert.pem"
ISSUER_KEY="${SRC_ISSUER_DIR}/issuer-key.pem"
ISSUER_CERT="${SRC_ISSUER_DIR}/issuer-cert.pem"
ISSUER_CHAIN="${SRC_ISSUER_DIR}/issuer.chain.pem"

mkdir -p "${DST_ROOT_CA}" "${DST_ICA}"

if [[ ! -f "${ROOT_KEY}" || ! -f "${ROOT_CERT}" ]]; then
  echo "Missing dataspace-ca root material."
  echo "Expected:"
  echo "  ${ROOT_KEY}"
  echo "  ${ROOT_CERT}"
  echo
  echo "Generate it first with dataspace-ca-ts root:bootstrap."
  exit 1
fi

if [[ ! -f "${ISSUER_KEY}" || ! -f "${ISSUER_CERT}" || ! -f "${ISSUER_CHAIN}" ]]; then
  echo "Missing dataspace-ca issuer material."
  echo "Expected:"
  echo "  ${ISSUER_KEY}"
  echo "  ${ISSUER_CERT}"
  echo "  ${ISSUER_CHAIN}"
  echo
  echo "Generate it first with dataspace-ca-ts issuer:bootstrap."
  exit 1
fi

cp -f "${ROOT_KEY}" "${DST_ROOT_CA}/ca-key.pem"
cp -f "${ROOT_CERT}" "${DST_ROOT_CA}/ca-cert.pem"
rm -f "${DST_ROOT_CA}/tls-cert.pem" "${DST_ROOT_CA}/fabric-ca-server.db"

cp -f "${ISSUER_KEY}" "${DST_ICA}/ca-key.pem"
cp -f "${ISSUER_CERT}" "${DST_ICA}/ca-cert.pem"
cp -f "${ISSUER_CHAIN}" "${DST_ICA}/ca-chain.pem"
rm -f "${DST_ICA}/tls-cert.pem" "${DST_ICA}/fabric-ca-server.db"

echo "Copied dataspace-ca material into Fabric devnet:"
echo "- Root CA source: ${SRC_ROOT_DIR}"
echo "- Issuer source:  ${SRC_ISSUER_DIR}"
echo "- Root CA dest:   ${DST_ROOT_CA}"
echo "- ICA dest:       ${DST_ICA}"
echo
echo "Next steps:"
echo "  1) cd ${REPO_ROOT}/infra/fabric/local-network"
echo "  2) ./scripts/01-up-cas.sh"
echo "  3) ./scripts/02-bootstrap-network.sh"
