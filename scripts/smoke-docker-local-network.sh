#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-gwtemplate}"
CONTAINER_NAME="${CONTAINER_NAME:-gw-core-local-network-smoke}"
HOST_PORT="${HOST_PORT:-18081}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
DOCKER_NETWORK="${DOCKER_NETWORK:-gdc-fabric-v3-devnet}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-fabric}"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
RUN_FULL_SMOKE="${RUN_FULL_SMOKE:-true}"
KEEP_CONTAINER="${KEEP_CONTAINER:-false}"
SKIP_FABRIC_PREP="${SKIP_FABRIC_PREP:-false}"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: bash scripts/smoke-docker-local-network.sh

Build the image first with docker_build_local.sh. This script then prepares
Fabric local-network, runs that exact image, verifies host discovery, and runs
the canonical consent and SMART access smokes.

Environment:
  IMAGE_NAME       Local image to validate
  RUN_FULL_SMOKE   true runs consent and SMART smokes; false checks ping only
  SKIP_FABRIC_PREP true reuses an already prepared local Fabric devnet
  KEEP_CONTAINER   true leaves the temporary container running
EOF
  exit 0
fi

for command_name in docker curl node npm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: missing command: ${command_name}" >&2
    exit 2
  }
done

bash "${ROOT_DIR}/scripts/check-identity-chaincode-parity.sh"

docker image inspect "$IMAGE_NAME" >/dev/null 2>&1 || {
  echo "ERROR: local image not found: ${IMAGE_NAME}" >&2
  exit 2
}

cleanup() {
  if [[ "$KEEP_CONTAINER" != "true" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"
if [[ "$SKIP_FABRIC_PREP" != "true" ]]; then
  node ./scripts/bootstrap-local-fabric-stack.mjs --prepare-only --no-bootstrap-tenant
fi

docker ps --format '{{.Names}}' | grep -qx 'gdc-peer0-org1' || {
  echo 'ERROR: local Fabric peer is not running: gdc-peer0-org1' >&2
  exit 2
}
docker ps --format '{{.Names}}' | grep -qx 'gdc-fabric-tools' || {
  echo 'ERROR: local Fabric tools container is not running: gdc-fabric-tools' >&2
  exit 2
}

FABRIC_PEER_ENDPOINT_VALUE=peer0-org1:7051 npm run prepare:local-fabric-env
docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1 || {
  echo "ERROR: Fabric Docker network not found: ${DOCKER_NETWORK}" >&2
  exit 2
}

ENV_FILE="$ENV_FILE" IMAGE_NAME="$IMAGE_NAME" CONTAINER_NAME="$CONTAINER_NAME" \
HOST_PORT="$HOST_PORT" CONTAINER_PORT="$CONTAINER_PORT" DOCKER_NETWORK="$DOCKER_NETWORK" \
FORCE_RECREATE=true ./docker_run_local.sh

PING_URL="${BASE_URL}/host/cds-eu/v1/local-network/.well-known/ping"
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 2 "$PING_URL" >/dev/null 2>&1; then
    echo "Docker local-network ping succeeded: ${PING_URL}"
    break
  fi
  sleep 1
done
curl --fail --silent --show-error --max-time 5 "$PING_URL" >/dev/null || {
  docker logs "$CONTAINER_NAME" --tail 120 >&2 || true
  echo "ERROR: Docker local-network ping failed: ${PING_URL}" >&2
  exit 1
}

if [[ "$RUN_FULL_SMOKE" == "true" ]]; then
  BASE_URL="$BASE_URL" npx dotenv -e "$ENV_FILE" -- ./scripts/bootstrap-single-tenant.sh
  BASE_URL="$BASE_URL" bash ./scripts/smoke-consentaccess-local-network.sh
  BASE_URL="$BASE_URL" bash ./scripts/smoke-smart-access-local-network.sh
fi

echo "Validated image: ${IMAGE_NAME}"
echo "Image ID: $(docker image inspect "$IMAGE_NAME" --format '{{.Id}}')"
