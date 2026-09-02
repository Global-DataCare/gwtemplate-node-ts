#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GW_PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [[ "$NODE_MAJOR" != '24' ]]; then
  echo "ERROR: secure local E2E requires Node 24; active runtime is ${NODE_VERSION}." >&2
  exit 2
fi

resolve_sdk_root() {
  if [[ -n "${GDC_SDK_NODE_ROOT:-}" ]]; then
    printf '%s' "$GDC_SDK_NODE_ROOT"
    return
  fi
  local candidate
  for candidate in "${GW_PROJECT_ROOT}/../gdc-sdk-node-ts" "${GW_PROJECT_ROOT}/../../gdc-sdk-node-ts"; do
    if [[ -f "${candidate}/package.json" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  return 1
}

SDK_PROJECT_ROOT="$(resolve_sdk_root || true)"
if [[ -z "$SDK_PROJECT_ROOT" || ! -f "${SDK_PROJECT_ROOT}/package.json" ]]; then
  echo 'ERROR: gdc-sdk-node-ts was not found; set GDC_SDK_NODE_ROOT to its checkout.' >&2
  exit 2
fi

for command_name in curl npm node; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: missing required command ${command_name}." >&2
    exit 2
  }
done

RUN_ID="${LIVE_GW_RUN_ID:-$(date -u +%Y%m%dt%H%M%S)}"
HOST_ID_VALUE="${HOST_ID_VALUE:-livee2e-${RUN_ID}-host}"
TENANT_ID="${TENANT_ID:-livee2e-${RUN_ID}}"
TENANT_ROUTE_ID="${TENANT_ROUTE_ID:-${TENANT_ID}}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
RESULTS_DIR="${LIVE_GW_RESULTS_DIR:-${GW_PROJECT_ROOT}/test-results}"
GW_LOG_FILE="${LIVE_GW_LOG_FILE:-${RESULTS_DIR}/gw-secure-e2e-${RUN_ID}.log}"
E2E_LOG_FILE="${LIVE_GW_E2E_LOG_FILE:-${RESULTS_DIR}/sdk-secure-e2e-${RUN_ID}.log}"
mkdir -p "$RESULTS_DIR"

cleanup() {
  if [[ -n "${GW_PID:-}" ]]; then
    kill "$GW_PID" >/dev/null 2>&1 || true
  fi
  (cd "$GW_PROJECT_ROOT" && bash ./scripts/local-close.sh) >/dev/null 2>&1 || true
}
trap cleanup EXIT

(cd "$GW_PROJECT_ROOT" && bash ./scripts/local-close.sh)
(
  cd "$GW_PROJECT_ROOT"
  HOST_ID_VALUE="$HOST_ID_VALUE" npm run api:local-firestore-demo
) >"$GW_LOG_FILE" 2>&1 &
GW_PID=$!

ready='false'
for _ in $(seq 1 120); do
  if curl -fsS "${BASE_URL}/host/ping" >/dev/null 2>&1; then
    ready='true'
    break
  fi
  kill -0 "$GW_PID" >/dev/null 2>&1 || break
  sleep 2
done
if [[ "$ready" != 'true' ]]; then
  echo "ERROR: local GW did not become ready; see ${GW_LOG_FILE}." >&2
  tail -n 80 "$GW_LOG_FILE" >&2 || true
  exit 1
fi

set +e
(
  cd "$SDK_PROJECT_ROOT"
  RUN_LIVE_GW_E2E=1 \
  RUN_LIVE_GW_E2E_ACTOR_CHAIN=1 \
  RUN_LIVE_GW_E2E_IPS_INGESTION=1 \
  RUN_LIVE_GW_E2E_INDIVIDUAL_LIFECYCLE=1 \
  RUN_LIVE_GW_E2E_PROFILE_RUNTIME=1 \
  RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION=1 \
  LIVE_GW_E2E_SUITE=all \
  LIVE_GW_E2E_TRANSPORT=all \
  HOST_ID_VALUE="$HOST_ID_VALUE" \
  TENANT_ID="$TENANT_ID" \
  TENANT_ROUTE_ID="$TENANT_ROUTE_ID" \
  BASE_URL="$BASE_URL" \
  npm run test:e2e:live-gw
) 2>&1 | tee "$E2E_LOG_FILE"
e2e_status=${PIPESTATUS[0]}
set -e

if [[ "$e2e_status" -ne 0 ]]; then
  exit "$e2e_status"
fi
if grep -Eiq '(^|[[:space:]])#?[[:space:]]*SKIP([[:space:]]|$)|skipped[[:space:]]+[1-9]|[1-9][0-9]*[[:space:]]+skipped' "$E2E_LOG_FILE"; then
  echo "ERROR: secure local E2E reported a skipped journey; see ${E2E_LOG_FILE}." >&2
  exit 1
fi

echo "OK: secure local SDK E2E passed on ${NODE_VERSION} with zero skipped journeys."
