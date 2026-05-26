#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:-${E2E_TENANT_ID:-acme}}"
JURISDICTION="${JURISDICTION:-${E2E_JURISDICTION:-ES}}"
SECTOR="${SECTOR:-${E2E_SECTOR:-health-care}}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
SUBJECT_ID="${SUBJECT_ID:-did:web:api.${TENANT_ID}.org:individual:subject-001}"
MODE="${MODE:-didcomm}" # didcomm | legacy-fhir

if [[ "${1:-}" == "--mode" ]]; then
  MODE="${2:-$MODE}"
  shift 2 || true
fi

if [[ "$MODE" != "didcomm" && "$MODE" != "legacy-fhir" ]]; then
  echo "ERROR: invalid MODE='$MODE' (allowed: didcomm, legacy-fhir)"
  exit 2
fi

THID_COMM="comm-medications-$(date +%s)"
THID_MED_SEARCH="medications-search-$(date +%s)"
THID_IPS_SEARCH="ips-search-$(date +%s)"

COMM_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Communication/_batch"
COMM_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Communication/_batch-response"
MED_SEARCH_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.api/MedicationStatement/_search"
MED_SEARCH_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.api/MedicationStatement/_batch-response"
IPS_SEARCH_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Bundle/_search"
IPS_SEARCH_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Bundle/_search-response"

poll_async() {
  local url="$1"
  local thid="$2"
  local attempts="${3:-40}"
  local sleep_s="${4:-1}"
  for _ in $(seq 1 "$attempts"); do
    local body
    body="$(curl -sS -X POST "$url" -H "Content-Type: application/json" -d "{\"thid\":\"$thid\"}")"
    local status
    status="$(echo "$body" | jq -r '.status // empty')"
    if [[ "$status" != "202" ]]; then
      echo "$body"
      return 0
    fi
    sleep "$sleep_s"
  done
  echo "{\"status\":500,\"issues\":{\"issue\":[{\"diagnostics\":\"Timeout polling thid=$thid\"}]}}"
  return 1
}

echo "[1/4] Rendering canonical synthetic demo payloads..."

render_demo_payload_with_runtime() {
  local payload_name="$1"
  SUBJECT_ID="$SUBJECT_ID" THID_COMM="$THID_COMM" THID_MED_SEARCH="$THID_MED_SEARCH" THID_IPS_SEARCH="$THID_IPS_SEARCH" \
    render_demo_payload "$payload_name"
}

DIDCOMM_COMM_REQ="$(render_demo_payload_with_runtime COMMUNICATION_DIDCOMM)"
LEGACY_FHIR_COMM_REQ="$(render_demo_payload_with_runtime COMMUNICATION_LEGACY_FHIR)"

COMM_CONTENT_TYPE="application/json"
COMM_REQ="$DIDCOMM_COMM_REQ"
if [[ "$MODE" == "legacy-fhir" ]]; then
  COMM_CONTENT_TYPE="application/fhir+json"
  COMM_REQ="$LEGACY_FHIR_COMM_REQ"
fi

COMM_SUBMIT="$(curl -sS -X POST "$COMM_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: $COMM_CONTENT_TYPE" \
  -d "$COMM_REQ")"
echo "$COMM_SUBMIT" | jq '.'

echo "[2/4] Polling Communication/_batch-response..."
COMM_DONE="$(poll_async "$COMM_POLL_URL" "$THID_COMM")"
echo "$COMM_DONE" | jq '.'

echo "[3/4] Searching MedicationStatement/_search..."
MED_SEARCH_REQ="$(render_demo_payload_with_runtime MEDICATION_SEARCH)"
MED_SUBMIT="$(curl -sS -X POST "$MED_SEARCH_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$MED_SEARCH_REQ")"
echo "$MED_SUBMIT" | jq '.'

echo "[3/4] Polling MedicationStatement search..."
MED_DONE="$(poll_async "$MED_SEARCH_POLL_URL" "$THID_MED_SEARCH")"
echo "$MED_DONE" | jq '.'

echo "[4/4] Searching IPS Bundle/_search by subject + medication section..."
IPS_SEARCH_REQ="$(render_demo_payload_with_runtime IPS_SEARCH)"
IPS_SUBMIT="$(curl -sS -X POST "$IPS_SEARCH_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$IPS_SEARCH_REQ")"
echo "$IPS_SUBMIT" | jq '.'

echo "[4/4] Polling IPS Bundle search..."
IPS_DONE="$(poll_async "$IPS_SEARCH_POLL_URL" "$THID_IPS_SEARCH")"
echo "$IPS_DONE" | jq '.'
