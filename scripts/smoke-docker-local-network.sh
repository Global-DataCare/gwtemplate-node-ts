#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-gwtemplate}"
CONTAINER_NAME="${CONTAINER_NAME:-gw-core-local-network-smoke}"
HOST_PORT="${HOST_PORT:-18081}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
GDC_CONTAINER_PREFIX="${GDC_CONTAINER_PREFIX:-gdc-public}"
DEVNET_NETWORK_NAME="${DEVNET_NETWORK_NAME:-gdc-public-local-network}"
DOCKER_NETWORK="${DOCKER_NETWORK:-${DEVNET_NETWORK_NAME}}"
FABRIC_PEER_CONTAINER="${GDC_CONTAINER_PREFIX}-peer0-host1"
FABRIC_TOOLS_CONTAINER="${GDC_CONTAINER_PREFIX}-fabric-tools"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-fabric}"
BASE_URL="http://127.0.0.1:${HOST_PORT}"
RUN_FULL_SMOKE="${RUN_FULL_SMOKE:-true}"
KEEP_CONTAINER="${KEEP_CONTAINER:-false}"
SKIP_FABRIC_PREP="${SKIP_FABRIC_PREP:-false}"
PERSISTENCE_PROFILE="${PERSISTENCE_PROFILE:-mem}"
RESET_OPEN_SOURCE_PERSISTENCE="${RESET_OPEN_SOURCE_PERSISTENCE:-true}"
OPEN_SOURCE_COMPOSE_FILE="${ROOT_DIR}/docker-compose.open-source-local.yml"

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
  PERSISTENCE_PROFILE mem (fast smoke) or postgres-ipfs (open-source evidence)
  RESET_OPEN_SOURCE_PERSISTENCE true starts PostgreSQL/IPFS with empty volumes
EOF
  exit 0
fi

for command_name in docker curl node npm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: missing command: ${command_name}" >&2
    exit 2
  }
done

if [[ "$PERSISTENCE_PROFILE" == "postgres-ipfs" ]] && ! command -v openssl >/dev/null 2>&1; then
  echo 'ERROR: missing command: openssl' >&2
  exit 2
fi

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

if [[ "$PERSISTENCE_PROFILE" != "mem" && "$PERSISTENCE_PROFILE" != "postgres-ipfs" ]]; then
  echo "ERROR: unsupported PERSISTENCE_PROFILE=${PERSISTENCE_PROFILE}" >&2
  exit 2
fi

cd "$ROOT_DIR"
if [[ "$SKIP_FABRIC_PREP" != "true" ]]; then
  GDC_CONTAINER_PREFIX="$GDC_CONTAINER_PREFIX" DEVNET_NETWORK_NAME="$DEVNET_NETWORK_NAME" \
    node ./scripts/bootstrap-local-fabric-stack.mjs --prepare-only --no-bootstrap-tenant
fi

docker ps --format '{{.Names}}' | grep -qx "$FABRIC_PEER_CONTAINER" || {
  echo "ERROR: local Fabric peer is not running: ${FABRIC_PEER_CONTAINER}" >&2
  exit 2
}
docker ps --format '{{.Names}}' | grep -qx "$FABRIC_TOOLS_CONTAINER" || {
  echo "ERROR: local Fabric tools container is not running: ${FABRIC_TOOLS_CONTAINER}" >&2
  exit 2
}

FABRIC_TOOLS_CONTAINER="$FABRIC_TOOLS_CONTAINER" \
  bash "${ROOT_DIR}/scripts/warm-local-fabric-chaincodes.sh"

FABRIC_PEER_ENDPOINT_VALUE=peer0-host1:7051 npm run prepare:local-fabric-env
docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1 || {
  echo "ERROR: Fabric Docker network not found: ${DOCKER_NETWORK}" >&2
  exit 2
}

if [[ "$PERSISTENCE_PROFILE" == "postgres-ipfs" ]]; then
  if [[ "$RESET_OPEN_SOURCE_PERSISTENCE" == "true" ]]; then
    DOCKER_NETWORK="$DOCKER_NETWORK" docker compose -f "$OPEN_SOURCE_COMPOSE_FILE" down -v
    for container_name in gw-open-source-postgres gw-open-source-ipfs; do
      docker rm -f "$container_name" >/dev/null 2>&1 || true
    done
    for attempt in $(seq 1 30); do
      remaining=false
      for container_name in gw-open-source-postgres gw-open-source-ipfs; do
        docker container inspect "$container_name" >/dev/null 2>&1 && remaining=true
      done
      [[ "$remaining" == "false" ]] && break
      [[ "$attempt" != "30" ]] || {
        echo 'ERROR: open-source persistence containers were not removed.' >&2
        exit 1
      }
      sleep 1
    done
  fi
  DOCKER_NETWORK="$DOCKER_NETWORK" docker compose -f "$OPEN_SOURCE_COMPOSE_FILE" up -d --wait
  local_kek_secret="${OPEN_SOURCE_LOCAL_KEK_SECRET:-$(openssl rand -base64 32 | tr -d '\n')}"
  cat >> "$ENV_FILE" <<EOF

# Open-source acceptance profile: PostgreSQL vault + IPFS confidential blobs.
DB_PROVIDER=postgres
STORAGE_PROVIDER=ipfs
POSTGRES_HOST=gw-open-source-postgres
POSTGRES_PORT=5432
POSTGRES_DB=gwtemplate
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_SSL=false
POSTGRES_SCHEMA=public
IPFS_API_URL=http://gw-open-source-ipfs:5001
IPFS_GATEWAY_URL=http://gw-open-source-ipfs:8080
IPFS_MFS_ROOT=/gwtemplate/blobs
ENVELOPE_PROVIDER=local
KEK_SECRET=${local_kek_secret}
CONFIDENTIAL_JWE_INLINE_MAX_BYTES=1
EOF
fi

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
  BASE_URL="$BASE_URL" FABRIC_TOOLS_CONTAINER="$FABRIC_TOOLS_CONTAINER" \
    bash ./scripts/smoke-consentaccess-local-network.sh
  BASE_URL="$BASE_URL" FABRIC_TOOLS_CONTAINER="$FABRIC_TOOLS_CONTAINER" \
    bash ./scripts/smoke-smart-access-local-network.sh
fi

if [[ "$PERSISTENCE_PROFILE" == "postgres-ipfs" ]]; then
  postgres_documents="$(docker exec gw-open-source-postgres psql -U postgres -d gwtemplate -Atc \
    'SELECT count(*) FROM public.vault_documents WHERE deleted_at IS NULL')"
  ipfs_blobs="$(docker exec gw-open-source-ipfs sh -lc \
    'ipfs files ls /gwtemplate/blobs 2>/dev/null | wc -l | tr -d " "')"
  [[ "$postgres_documents" -gt 0 ]] || { echo 'ERROR: PostgreSQL contains no persisted vault documents.' >&2; exit 1; }
  [[ "$ipfs_blobs" -gt 0 ]] || { echo 'ERROR: IPFS contains no externalized confidential JWE blobs.' >&2; exit 1; }

  docker restart "$CONTAINER_NAME" >/dev/null
  for _ in $(seq 1 60); do
    curl --fail --silent --max-time 2 "$PING_URL" >/dev/null 2>&1 && break
    sleep 1
  done
  curl --fail --silent --show-error --max-time 5 "$PING_URL" >/dev/null || {
    echo 'ERROR: GW did not recover from PostgreSQL/IPFS after restart.' >&2
    exit 1
  }
  tenant_did_url="${BASE_URL}/acme-id/cds-ES/v1/health-care/.well-known/did.json"
  curl --fail --silent --show-error --max-time 10 "$tenant_did_url" \
    | jq -e '.id | startswith("did:web:")' >/dev/null || {
      echo 'ERROR: persisted tenant DID did not rehydrate after GW restart.' >&2
      exit 1
    }
  echo "Open-source persistence validated: postgres_documents=${postgres_documents} ipfs_jwe_blobs=${ipfs_blobs} restart=ok tenant_rehydration=ok"
fi

echo "Validated image: ${IMAGE_NAME}"
echo "Image ID: $(docker image inspect "$IMAGE_NAME" --format '{{.Id}}')"
