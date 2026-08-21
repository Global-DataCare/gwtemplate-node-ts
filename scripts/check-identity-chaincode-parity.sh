#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_MULTICLOUD_DIR="${FABRIC_MULTICLOUD_DIR:-${ROOT_DIR}/../fabric-multicloud}"

if [[ ! -d "${FABRIC_MULTICLOUD_DIR}/devnet/fabric-v3/external-chaincodes" ]]; then
  echo "ERROR: canonical Fabric chaincodes not found under ${FABRIC_MULTICLOUD_DIR}." >&2
  exit 2
fi

for chaincode in organization-sc cryptographickey-sc; do
  local_dir="${ROOT_DIR}/chaincode/${chaincode}-javascript"
  canonical_dir="${FABRIC_MULTICLOUD_DIR}/devnet/fabric-v3/external-chaincodes/${chaincode}"
  if ! diff -qr \
    --exclude=node_modules \
    --exclude=coverage \
    --exclude=.nyc_output \
    "${local_dir}" "${canonical_dir}"; then
    echo "ERROR: ${chaincode} local-network mirror differs from fabric-multicloud." >&2
    echo "Update the canonical chaincode first, then synchronize the GW smoke mirror." >&2
    exit 1
  fi
done

echo "Identity chaincode parity verified: organization-sc, cryptographickey-sc"
