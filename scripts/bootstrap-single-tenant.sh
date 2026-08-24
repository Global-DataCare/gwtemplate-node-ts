#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_FABRIC_ENV_FILE="${PROJECT_ROOT}/.env.local-fabric"
LOCAL_FABRIC_DEVNET_PRESENT='false'
if [[ -f "${LOCAL_FABRIC_ENV_FILE}" ]]; then
  LOCAL_FABRIC_DEVNET_PRESENT='true'
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
JURISDICTION="${JURISDICTION:-ES}"
JURISDICTION_LOWER="$(printf '%s' "${JURISDICTION:-ES}" | tr '[:upper:]' '[:lower:]')"
HOST_JURISDICTION="${HOST_JURISDICTION:-EU}"
HOST_JURISDICTION_LOWER="$(printf '%s' "${HOST_JURISDICTION:-EU}" | tr '[:upper:]' '[:lower:]')"
VERSION="${VERSION:-v1}"
NETWORK_MODE_NORMALIZED="$(printf '%s' "${NETWORK_MODE:-}" | tr '[:upper:]' '[:lower:]')"
DEFAULT_HOST_NETWORK="test"
if [[ "$NETWORK_MODE_NORMALIZED" == "local-network" || "$NETWORK_MODE_NORMALIZED" == "test-network" || "$NETWORK_MODE_NORMALIZED" == "network" ]]; then
  DEFAULT_HOST_NETWORK="$NETWORK_MODE_NORMALIZED"
elif [[ "$LOCAL_FABRIC_DEVNET_PRESENT" == 'true' ]]; then
  DEFAULT_HOST_NETWORK="local-network"
fi
HOST_NETWORK="${HOST_NETWORK:-$DEFAULT_HOST_NETWORK}"
HOST_REGISTRY_SECTOR="${HOST_REGISTRY_SECTOR:-$HOST_NETWORK}"
SECTOR="${SECTOR:-health-care}"
TENANT_ID="${TENANT_ID:-acme-id}"
TAX_ID="${TAX_ID:-$TENANT_ID}"
LEGAL_NAME="${LEGAL_NAME:-Acme Organization SL}"
DISPLAY_NAME="${DISPLAY_NAME:-Acme Org}"
ORG_URL="${ORG_URL:-api.acme.org}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin1@acme.org}"
PERSON_OCCUPATION="${PERSON_OCCUPATION:-ISCO-08|1120}"
EMPLOYEE_COUNT="${EMPLOYEE_COUNT:-2}"
SERVICE_IDENTIFIER="${SERVICE_IDENTIFIER:-did:web:api-provider.example.com}"
SERVICE_URL="${SERVICE_URL:-${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION_LOWER}/v1/${SECTOR}}"
SERVICE_TYPE="${SERVICE_TYPE:-}"
SERVICE_AREA_SERVED="${SERVICE_AREA_SERVED:-$JURISDICTION}"
TERMS_OF_SERVICE="${TERMS_OF_SERVICE:-https://example.com/terms}"

# Host onboarding uses the host "registry sector", which is the deployment
# network selector (`test`, `local-network`, `test-network`, `network`), not the business sector.
# For the local Docker Fabric topology, `NETWORK_MODE=local-network`, so the canonical host
# onboarding surface becomes:
# - `/host/cds-<host-jurisdiction>/v1/local-network/registry/...`
# Business resources still use the tenant's business sector, for example:
# - `/<tenantId>/cds-ES/v1/health-care/...`

for cmd in curl jq node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

post_json() {
  local url="$1"
  local payload="$2"
  curl -sS -X POST "$url" \
    -H "Content-Type: $CONTENT_TYPE" \
    -H "Authorization: Bearer $AUTH_BEARER" \
    -d "$payload"
}

poll_async() {
  local url="$1"
  local thid="$2"
  post_json "$url" "$(jq -n --arg thid "$thid" '{thid:$thid}')"
}

# PostgreSQL-backed workers can complete after the first polling request. Keep
# the bootstrap honest: wait for the expected response shape instead of
# printing "ready" while the tenant is still pending.
poll_async_until() {
  local url="$1"
  local thid="$2"
  local jq_filter="$3"
  local operation_label="$4"
  local result=''

  for _ in $(seq 1 30); do
    result="$(poll_async "$url" "$thid")"
    if jq -e "$jq_filter" >/dev/null 2>&1 <<<"$result"; then
      printf '%s' "$result"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: timed out waiting for ${operation_label} (thid=${thid})" >&2
  jq '.' <<<"$result" >&2 || printf '%s\n' "$result" >&2
  return 1
}

echo "[bootstrap] ping: $BASE_URL/host/ping"
HOST_PING_URL="${BASE_URL}/host/cds-${HOST_JURISDICTION_LOWER}/${VERSION}/${HOST_NETWORK}/.well-known/ping"
echo "[bootstrap] ping: $HOST_PING_URL"
ping_body="$(curl -f -sS "$HOST_PING_URL" || true)"
if [[ -z "$ping_body" ]]; then
  echo "ERROR: gateway not reachable at $HOST_PING_URL"
  exit 1
fi

thid_org="thid-org-${TAX_ID}-$(date +%s)"
org_payload_overrides="$(jq -n \
  --arg thid "$thid_org" \
  --arg iss "$ADMIN_EMAIL" \
  --arg jurisdiction "$JURISDICTION" \
  --arg taxId "$TAX_ID" \
  --arg legalName "$LEGAL_NAME" \
  --arg displayName "$DISPLAY_NAME" \
  --argjson employeeCount "$EMPLOYEE_COUNT" \
  --arg orgUrl "$ORG_URL" \
  --arg adminEmail "$ADMIN_EMAIL" \
  --arg personOccupation "$PERSON_OCCUPATION" \
  --arg sector "$SECTOR" \
  --arg serviceIdentifier "$SERVICE_IDENTIFIER" \
  --arg serviceUrl "$SERVICE_URL" \
  --arg serviceType "$SERVICE_TYPE" \
  --arg serviceAreaServed "$SERVICE_AREA_SERVED" \
  --arg termsOfService "$TERMS_OF_SERVICE" \
  '{
    "/thid": $thid,
    "/iss": $iss,
    "/body/data/0/meta/claims/org.schema.Organization.address.addressCountry": $jurisdiction,
    "/body/data/0/meta/claims/org.schema.Organization.identifier.value": $taxId,
    "/body/data/0/meta/claims/org.schema.Organization.legalName": $legalName,
    "/body/data/0/meta/claims/org.schema.Organization.name": $displayName,
    "/body/data/0/meta/claims/org.schema.Organization.numberOfEmployees.value": $employeeCount,
    "/body/data/0/meta/claims/org.schema.Organization.url": $orgUrl,
    "/body/data/0/meta/claims/org.schema.Person.email": $adminEmail,
    "/body/data/0/meta/claims/org.schema.Person.hasOccupation": $personOccupation,
    "/body/data/0/meta/claims/org.schema.Service.category": $sector,
    "/body/data/0/meta/claims/org.schema.Service.identifier": $serviceIdentifier,
    "/body/data/0/meta/claims/org.schema.Service.url": $serviceUrl,
    "/body/data/0/meta/claims/org.schema.Service.areaServed": $serviceAreaServed,
    "/body/data/0/meta/claims/org.schema.Service.termsOfService": $termsOfService
  } + (if $serviceType != "" then {
    "/body/data/0/meta/claims/org.schema.Service.serviceType": $serviceType
  } else {} end)')"
org_payload="$(render_example_payload ORGANIZATION_REGISTRATION_REQUEST "$org_payload_overrides")"

echo "[bootstrap] organization registration (taxId=$TAX_ID)"
org_create="$(post_json "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch" "$org_payload")"
echo "$org_create" | jq '.'
org_err="$(echo "$org_create" | jq -r '.body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')"
if [[ -n "$org_err" && "$org_err" != *"already exists"* ]]; then
  echo "ERROR: organization registration failed: $org_err"
  exit 1
fi

if [[ -z "$org_err" ]]; then
  org_poll="$(poll_async_until \
    "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch-response" \
    "$thid_org" \
    '(.body.data[0].meta.claims["org.schema.Offer.identifier"] // .data[0].meta.claims["org.schema.Offer.identifier"] // "") | length > 0' \
    'organization Offer')"
  echo "$org_poll" | jq '.'
  offer_id="$(echo "$org_poll" | jq -r '.body.data[0].meta.claims["org.schema.Offer.identifier"] // .data[0].meta.claims["org.schema.Offer.identifier"] // empty')"
  [[ -n "$offer_id" ]] || { echo 'ERROR: organization registration completed without an Offer identifier.' >&2; exit 1; }

  thid_order="thid-order-${TAX_ID}-$(date +%s)"
  order_payload_overrides="$(jq -n --arg thid "$thid_order" --arg offer "$offer_id" --arg iss "$ADMIN_EMAIL" '{
    "/thid": $thid,
    "/iss": $iss,
    "/body/data/0/meta/claims/org.schema.Order.acceptedOffer.identifier": $offer,
    "/body/data/0/meta/claims/Order.acceptedOffer.identifier": $offer
  }')"
  order_payload="$(render_example_payload ORGANIZATION_ORDER_REQUEST "$order_payload_overrides")"

  echo "[bootstrap] order confirmation"
  order_create="$(post_json "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch" "$order_payload")"
  echo "$order_create" | jq '.'
  order_poll="$(poll_async_until \
    "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch-response" \
    "$thid_order" \
    '[.body.data[]?.response?.status, .data[]?.response?.status] | any(. == "201" or . == 201)' \
    'organization Order activation')"
  echo "$order_poll" | jq '.'
fi

echo "OK: tenant taxId='$TAX_ID' ready for individual/org.schema and FHIR flows"
