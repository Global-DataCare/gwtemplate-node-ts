#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVNET_ROOT="${FABRIC_DEVNET_ROOT:-${ROOT}/../fabric-multicloud/devnet/fabric-v3}"
DEVNET_ENV="${DEVNET_ROOT}/.env.fabric-devnet"

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

[[ -d "${DEVNET_ROOT}" ]] || fail "Missing devnet directory: ${DEVNET_ROOT}"

if [[ -f "${DEVNET_ENV}" ]]; then
  echo "Fabric devnet env already present: ${DEVNET_ENV}"
  exit 0
fi

echo "Generating Fabric devnet env: ${DEVNET_ENV}"
(
  cd "${DEVNET_ROOT}"
  bash ./scripts/04-generate-backend-env.sh
)

[[ -f "${DEVNET_ENV}" ]] || fail "Expected generated env not found: ${DEVNET_ENV}"
echo "Generated Fabric devnet env: ${DEVNET_ENV}"
