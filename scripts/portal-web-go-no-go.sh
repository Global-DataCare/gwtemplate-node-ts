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
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch" \
  "{\"thid\":\"$THID_ORG_OFFER\",\"body\":{\"data\":[{\"type\":\"Organization-registration-form-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Organization.name\":\"Org Offer Test\"},\"attachments\":[{\"id\":\"sanitary-registry-pdf\",\"description\":\"Sanitary registry proof\",\"media_type\":\"application/pdf\",\"data\":{\"base64\":\"JVBERi0xLjQKJcTl8uXrCg==\"}}]}}]}}")"
assert_route_available "Organization _batch submit (Offer)" "$CODE"

# 5) Organization offer poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch-response" \
  "{\"thid\":\"$THID_ORG_OFFER\"}")"
assert_route_available "Organization _batch poll (Offer)" "$CODE"

# 6) Organization order submit
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch" \
  "{\"thid\":\"$THID_ORG_ORDER\",\"body\":{\"data\":[{\"type\":\"Order-registration-request-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Order.acceptedOffer.identifier\":\"dummy-offer-id\"}}}]}}")"
assert_route_available "Organization Order _batch submit" "$CODE"

# 7) Organization order poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch-response" \
  "{\"thid\":\"$THID_ORG_ORDER\"}")"
assert_route_available "Organization Order _batch poll" "$CODE"

# 8) Employee submit
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch" \
  "{\"thid\":\"$THID_EMPLOYEE\",\"body\":{\"data\":[{\"type\":\"Employee-create-request-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Person.email\":\"doctor1@example.com\",\"org.schema.Person.hasOccupation\":\"ISCO-08|2211\"}}}]}}")"
assert_route_available "Employee _batch submit" "$CODE"

# 9) Employee poll
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch-response" \
  "{\"thid\":\"$THID_EMPLOYEE\"}")"
assert_route_available "Employee _batch poll" "$CODE"

# 10) Token exchange submit
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange" \
  "{\"thid\":\"$THID_EXCHANGE\",\"subject_token\":\"dummy-license-code\"}")"
assert_route_available "Token _exchange submit" "$CODE"

# 11) Token exchange poll
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange-response" \
  "{\"thid\":\"$THID_EXCHANGE\"}")"
assert_route_available "Token _exchange poll" "$CODE"

# 12) Device DCR submit
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Device/_dcr" \
  "{\"thid\":\"$THID_DCR\",\"client_name\":\"web-portal-test\",\"jwks\":{\"keys\":[]}}")"
assert_route_available "Device _dcr submit" "$CODE"

# 13) SMART token submit
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/smart/token" \
  "{\"thid\":\"$THID_SMART\",\"scope\":\"individual.onboard\"}")"
assert_route_available "SMART token submit" "$CODE"

# 14) Family organization submit
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.schema/Organization/_batch" \
  "{\"thid\":\"$THID_FAMILY\",\"body\":{\"data\":[{\"type\":\"Family-registration-form-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Organization.name\":\"Family Test\",\"org.schema.Person.email\":\"family@example.com\"}}}]}}")"
assert_route_available "Family Organization _batch submit" "$CODE"

echo
echo "Summary: pass=$PASS_COUNT fail=$FAIL_COUNT"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "NO-GO"
  exit 1
fi
echo "GO"
