#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
JURISDICTION="${JURISDICTION:-ES}"
HOST_REGISTRY_SECTOR="${HOST_REGISTRY_SECTOR:-test}"
TENANT_ID="${TENANT_ID:-acme}"
SECTOR="${SECTOR:-health-care}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"

THID_SUFFIX="$(date +%s)"
THID_ACTIVATE="thid-activate-${THID_SUFFIX}"
THID_ORG_OFFER="thid-org-offer-${THID_SUFFIX}"
THID_ORG_ORDER="thid-org-order-${THID_SUFFIX}"
THID_EMPLOYEE="thid-employee-${THID_SUFFIX}"
THID_EXCHANGE="thid-exchange-${THID_SUFFIX}"
THID_DCR="thid-dcr-${THID_SUFFIX}"
THID_SMART="thid-smart-${THID_SUFFIX}"
THID_FAMILY="thid-family-${THID_SUFFIX}"

PASS_COUNT=0
FAIL_COUNT=0

print_result() {
  local status="$1"
  local name="$2"
  local code="$3"
  local detail="$4"
  if [[ "$status" == "PASS" ]]; then
    printf '[PASS] %-45s status=%s %s\n' "$name" "$code" "$detail"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    printf '[FAIL] %-45s status=%s %s\n' "$name" "$code" "$detail"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 2
  }
}

require_cmd curl
require_cmd node
require_cmd jq

call_api() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o /tmp/gw_check_body.out -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer $AUTH_BEARER" \
      -H "Content-Type: $CONTENT_TYPE" \
      -d "$body" || true)"
  else
    code="$(curl -sS -o /tmp/gw_check_body.out -w "%{http_code}" -X "$method" "$url" || true)"
  fi
  echo "$code"
}

assert_ping() {
  local name="$1"
  local code="$2"
  if [[ "$code" == "200" ]]; then
    print_result "PASS" "$name" "$code" ""
  else
    local snippet
    snippet="$(head -c 180 /tmp/gw_check_body.out 2>/dev/null || true)"
    print_result "FAIL" "$name" "$code" "expected=200 body='${snippet}'"
  fi
}

render_example_payload() {
  local fixture_name="$1"
  local overrides_json="${2:-\{\}}"
  TS_NODE_TRANSPILE_ONLY=1 TS_NODE_SKIP_IGNORE=1 TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}' \
    node --loader ts-node/esm --experimental-specifier-resolution=node \
    ./scripts/render-example-payload.mts "$fixture_name" "$overrides_json"
}

assert_route_available() {
  local name="$1"
  local code="$2"
  if [[ "$code" == "000" || "$code" == "404" ]]; then
    local snippet
    snippet="$(head -c 180 /tmp/gw_check_body.out 2>/dev/null || true)"
    print_result "FAIL" "$name" "$code" "route unavailable body='${snippet}'"
  else
    print_result "PASS" "$name" "$code" ""
  fi
}

echo "Running Portal Web Go/No-Go checks against:"
echo "  BASE_URL=$BASE_URL"
echo "  tenant=$TENANT_ID jurisdiction=$JURISDICTION sector=$SECTOR host_registry_sector=$HOST_REGISTRY_SECTOR"
echo

# 1) Ping
CODE="$(call_api GET "$BASE_URL/host/.well-known/ping")"
assert_ping "Ping host/.well-known/ping" "$CODE"

# 2) Activate submit
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_activate" \
  "{\"thid\":\"$THID_ACTIVATE\",\"body\":{\"data\":[{\"type\":\"Organization-activation-request-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"vp_token\":\"<vp-token>\"}}}]}}")"
assert_route_available "Organization _activate submit" "$CODE"

# 3) Activate poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_activate-response" \
  "{\"thid\":\"$THID_ACTIVATE\"}")"
assert_route_available "Organization _activate poll" "$CODE"

# 4) Organization offer submit (legacy _batch flow)
ORG_OFFER_REQ="$(render_example_payload ORGANIZATION_REGISTRATION_REQUEST "$(jq -n \
  --arg thid "$THID_ORG_OFFER" \
  --arg tenantId "$TENANT_ID" \
  --arg jurisdiction "$JURISDICTION" \
  --arg sector "$SECTOR" \
  '{
    "/thid": $thid,
    "/iss": "admin1@acme.org",
    "/body/data/0/meta/claims/org.schema.Organization.identifier.value": $tenantId,
    "/body/data/0/meta/claims/org.schema.Organization.address.addressCountry": $jurisdiction,
    "/body/data/0/meta/claims/org.schema.Service.category": $sector
  }' )")"
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch" \
  "$ORG_OFFER_REQ")"
assert_route_available "Organization _batch submit (Offer)" "$CODE"

# 5) Organization offer poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch-response" \
  "{\"thid\":\"$THID_ORG_OFFER\"}")"
assert_route_available "Organization _batch poll (Offer)" "$CODE"

# 6) Organization order submit
ORG_ORDER_REQ="$(render_example_payload ORGANIZATION_ORDER_REQUEST "$(jq -n --arg thid "$THID_ORG_ORDER" '{
  "/thid": $thid,
  "/body/data/0/meta/claims/Order.acceptedOffer.identifier": "dummy-offer-id"
}')")"
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch" \
  "$ORG_ORDER_REQ")"
assert_route_available "Organization Order _batch submit" "$CODE"

# 7) Organization order poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch-response" \
  "{\"thid\":\"$THID_ORG_ORDER\"}")"
assert_route_available "Organization Order _batch poll" "$CODE"

# 8) Employee submit
EMPLOYEE_REQ="$(render_example_payload EMPLOYEE_REGISTRATION_REQUEST "$(jq -n --arg thid "$THID_EMPLOYEE" '{
  "/thid": $thid,
  "/body/data/0/meta/claims/org.schema.Person.email": "doctor1@example.com",
  "/body/data/0/meta/claims/org.schema.Person.hasOccupation.identifier.value": "ISCO-08|2211"
}')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch" \
  "$EMPLOYEE_REQ")"
assert_route_available "Employee _batch submit" "$CODE"

# 9) Employee poll
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch-response" \
  "{\"thid\":\"$THID_EMPLOYEE\"}")"
assert_route_available "Employee _batch poll" "$CODE"

# 10) Token exchange submit
TOKEN_EXCHANGE_REQ="$(render_example_payload INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST "$(jq -n --arg thid "$THID_EXCHANGE" '{
  "/thid": $thid,
  "/body/subject_token": "dummy-license-code"
}')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange" \
  "$TOKEN_EXCHANGE_REQ")"
assert_route_available "Token _exchange submit" "$CODE"

# 11) Token exchange poll
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange-response" \
  "{\"thid\":\"$THID_EXCHANGE\"}")"
assert_route_available "Token _exchange poll" "$CODE"

# 12) Device DCR submit
DEVICE_DCR_REQ="$(render_example_payload DEVICE_REGISTRATION_REQUEST "$(jq -n --arg thid "$THID_DCR" '{
  "/thid": $thid,
  "/body/client_name": "web-portal-test",
  "/body/jwks/keys": []
}')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Device/_dcr" \
  "$DEVICE_DCR_REQ")"
assert_route_available "Device _dcr submit" "$CODE"

# 13) SMART token submit
SMART_REQ="$(render_example_payload SMART_TOKEN_REQUEST "$(jq -n --arg thid "$THID_SMART" '{
  "/thid": $thid,
  "/body/scope": "individual.onboard"
}')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/smart/token" \
  "$SMART_REQ")"
assert_route_available "SMART token submit" "$CODE"

# 14) Family organization submit
FAMILY_REQ="$(render_example_payload FAMILY_REGISTRATION_REQUEST "$(jq -n \
  --arg thid "$THID_FAMILY" \
  '{
    "/thid": $thid,
    "/body/data/0/meta/claims/Organization.owner.email": "family@example.com"
  }' )")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.schema/Organization/_batch" \
  "$FAMILY_REQ")"
assert_route_available "Family Organization _batch submit" "$CODE"

echo
echo "Summary: pass=$PASS_COUNT fail=$FAIL_COUNT"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "NO-GO"
  exit 1
fi
echo "GO"
