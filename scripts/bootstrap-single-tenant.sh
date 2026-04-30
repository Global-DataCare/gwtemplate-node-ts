#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
JURISDICTION="${JURISDICTION:-ES}"
HOST_REGISTRY_SECTOR="${HOST_REGISTRY_SECTOR:-test}"
TENANT_ID="${TENANT_ID:-acme}"
SECTOR="${SECTOR:-health-care}"

for cmd in curl jq; do
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

thid_org="thid-org-${TENANT_ID}-$(date +%s)"
org_payload="$(jq -n \
  --arg thid "$thid_org" \
  --arg tenant "$TENANT_ID" \
  --arg sector "$SECTOR" \
  '{
    thid:$thid,
    iss:"admin@example.com",
    aud:"did:web:host.example.com",
    body:{
      data:[{
        type:"Organization-registration-form-v1.0",
        meta:{claims:{
          "@context":"org.schema",
          "@type":"template",
          "org.schema.Organization.legalName":"Demo Tenant",
          "org.schema.Organization.identifier.additionalType":"TAX",
          "org.schema.Organization.identifier.value":("A-" + $tenant + "-001"),
          "org.schema.Organization.alternateName":$tenant,
          "org.schema.Organization.address.addressCountry":"ES",
          "org.schema.Person.identifier":"urn:uuid:admin-demo-001",
          "org.schema.Person.hasOccupation":"ISCO-08|1120",
          "org.schema.Person.email":"admin@example.com",
          "org.schema.Service.category":$sector,
          "org.schema.Service.identifier":"did:web:api.example.com",
          "org.schema.Service.termsOfService":"https://example.com/terms",
          "org.schema.Service.serviceType":"http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC"
        }}
      }]
    }
  }')"

echo "[bootstrap] organization registration ($TENANT_ID)"
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
    thid_order="thid-order-${TENANT_ID}-$(date +%s)"
    order_payload="$(jq -n --arg thid "$thid_order" --arg offer "$offer_id" '{
      thid:$thid,
      iss:"admin@example.com",
      aud:"did:web:host.example.com",
      body:{data:[{type:"Organization-order-request-v1.0",meta:{claims:{"@context":"org.schema","Order.acceptedOffer.identifier":$offer}}}]}
    }')"

    echo "[bootstrap] order confirmation"
    order_create="$(post_json "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch" "$order_payload")"
    echo "$order_create" | jq '.'
    order_poll="$(poll_async "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch-response" "$thid_order")"
    echo "$order_poll" | jq '.'
  fi
fi

echo "OK: tenant '$TENANT_ID' ready for individual/org.schema and FHIR flows"
