#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
JURISDICTION="${JURISDICTION:-ES}"
HOST_REGISTRY_SECTOR="${HOST_REGISTRY_SECTOR:-test}"
SECTOR="${SECTOR:-health-care}"
TENANT_ID="${TENANT_ID:-acme-id}"
TAX_ID="${TAX_ID:-$TENANT_ID}"
LEGAL_NAME="${LEGAL_NAME:-Acme Organization SL}"
DISPLAY_NAME="${DISPLAY_NAME:-Acme Org}"
ORG_URL="${ORG_URL:-api.acme.org}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin1@acme.org}"
PERSON_OCCUPATION="${PERSON_OCCUPATION:-ISCO-08|1120}"
SERVICE_IDENTIFIER="${SERVICE_IDENTIFIER:-did:web:api-provider.example.com}"
TERMS_OF_SERVICE="${TERMS_OF_SERVICE:-https://example.com/terms}"

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

echo "[bootstrap] ping: $BASE_URL/host/.well-known/ping"
code="$(curl -sS -o /tmp/bootstrap-tenant-ping.out -w "%{http_code}" "$BASE_URL/host/.well-known/ping" || true)"
if [[ "$code" != "200" ]]; then
  echo "ERROR: gateway not reachable (status=$code)"
  [[ -s /tmp/bootstrap-tenant-ping.out ]] && head -c 220 /tmp/bootstrap-tenant-ping.out
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
  --arg orgUrl "$ORG_URL" \
  --arg adminEmail "$ADMIN_EMAIL" \
  --arg personOccupation "$PERSON_OCCUPATION" \
  --arg sector "$SECTOR" \
  --arg serviceIdentifier "$SERVICE_IDENTIFIER" \
  --arg termsOfService "$TERMS_OF_SERVICE" \
  '{
    "/thid": $thid,
    "/iss": $iss,
    "/body/data/0/meta/claims/org.schema.Organization.address.addressCountry": $jurisdiction,
    "/body/data/0/meta/claims/org.schema.Organization.identifier.value": $taxId,
    "/body/data/0/meta/claims/org.schema.Organization.legalName": $legalName,
    "/body/data/0/meta/claims/org.schema.Organization.name": $displayName,
    "/body/data/0/meta/claims/org.schema.Organization.url": $orgUrl,
    "/body/data/0/meta/claims/org.schema.Person.email": $adminEmail,
    "/body/data/0/meta/claims/org.schema.Person.hasOccupation": $personOccupation,
    "/body/data/0/meta/claims/org.schema.Service.category": $sector,
    "/body/data/0/meta/claims/org.schema.Service.identifier": $serviceIdentifier,
    "/body/data/0/meta/claims/org.schema.Service.termsOfService": $termsOfService
  }')"
org_payload="$(render_example_payload ORGANIZATION_REGISTRATION_REQUEST "$org_payload_overrides")"

echo "[bootstrap] organization registration (taxId=$TAX_ID)"
org_create="$(post_json "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch" "$org_payload")"
echo "$org_create" | jq '.'
org_err="$(echo "$org_create" | jq -r '.body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')"
if [[ -n "$org_err" && "$org_err" != *"already exists"* ]]; then
  echo "ERROR: organization registration failed: $org_err"
  exit 1
fi

if [[ -z "$org_err" ]]; then
  org_poll="$(poll_async "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch-response" "$thid_org")"
  echo "$org_poll" | jq '.'
  offer_id="$(echo "$org_poll" | jq -r '.body.data[0].meta.claims["org.schema.Offer.identifier"] // .data[0].meta.claims["org.schema.Offer.identifier"] // empty')"
  if [[ -n "$offer_id" ]]; then
    thid_order="thid-order-${TAX_ID}-$(date +%s)"
    order_payload_overrides="$(jq -n --arg thid "$thid_order" --arg offer "$offer_id" --arg iss "$ADMIN_EMAIL" '{
      "/thid": $thid,
      "/iss": $iss,
      "/body/data/0/meta/claims/Order.acceptedOffer.identifier": $offer
    }')"
    order_payload="$(render_example_payload ORGANIZATION_ORDER_REQUEST "$order_payload_overrides")"

    echo "[bootstrap] order confirmation"
    order_create="$(post_json "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch" "$order_payload")"
    echo "$order_create" | jq '.'
    order_poll="$(poll_async "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch-response" "$thid_order")"
    echo "$order_poll" | jq '.'
  fi
fi

echo "OK: tenant taxId='$TAX_ID' ready for individual/org.schema and FHIR flows"
