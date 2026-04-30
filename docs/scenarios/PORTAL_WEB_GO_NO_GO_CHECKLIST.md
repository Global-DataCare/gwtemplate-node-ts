# Portal Web Go/No-Go Checklist (5 minutes, 14 calls)

Purpose: quickly validate `gwtemplate-node-ts` readiness before testing `gdc-sdk-client-ts` from `apptemplate` web.

Note on route conventions:

- This checklist validates the canonical legacy surface under `identity/openid/...`.
- `gwtemplate-node-ts` also accepts unified `identity/auth/...` paths and normalizes them internally for compatibility.

Automated version:

```bash
npm run check:portal-web-go-no-go
```

This runs the same 14-call route readiness checks and returns `GO`/`NO-GO`.

## 0) Variables

```bash
export BASE_URL="http://localhost:3000"
export AUTH_BEARER="demo-token"
export JURISDICTION="ES"
export HOST_REGISTRY_SECTOR="test"
export TENANT_ID="acme"
export SECTOR="health-care"
```

Use the same values as your frontend profile (`apptemplate` env).

---

## 1) Health/ping

```bash
curl -sS -i "$BASE_URL/host/.well-known/ping"
```

Expected: HTTP `200`.

---

## 2) Activate organization submit (`_activate`)

```bash
THID_ACTIVATE="thid-activate-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_activate" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{
    \"thid\":\"$THID_ACTIVATE\",
    \"body\":{\"data\":[{\"type\":\"Organization-activation-request-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"vp_token\":\"<vp-token>\"}}}]}
  }"
```

Expected: HTTP `202` (or domain `4xx` if payload invalid, but route exists).

---

## 3) Activate organization poll (`_activate-response`)

```bash
curl -sS -i -X POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_activate-response" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_ACTIVATE\"}"
```

Expected: HTTP `202|200|500`, never `404 route not found`.

---

## 4) Legacy organization registration submit (`Organization/_batch`, Offer path with attachments)

```bash
THID_ORG_OFFER="thid-org-offer-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{
    \"thid\":\"$THID_ORG_OFFER\",
    \"body\":{\"data\":[{\"type\":\"Organization-registration-form-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Organization.name\":\"Org Offer Test\"},\"attachments\":[{\"id\":\"sanitary-registry-pdf\",\"description\":\"Sanitary registry proof\",\"media_type\":\"application/pdf\",\"data\":{\"base64\":\"JVBERi0xLjQKJcTl8uXrCg==\"}}]}}]}
  }"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).  
Note: approval/business checks can be async and may involve ICA + external validators before Offer is returned in `_batch-response`.

---

## 5) Legacy organization registration poll (`Organization/_batch-response`)

```bash
curl -sS -i -X POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Organization/_batch-response" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_ORG_OFFER\"}"
```

Expected: HTTP `202|200|500`, never `404 route not found`.

---

## 6) Legacy organization order submit (`Order/_batch`)

```bash
THID_ORG_ORDER="thid-org-order-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{
    \"thid\":\"$THID_ORG_ORDER\",
    \"body\":{\"data\":[{\"type\":\"Order-registration-request-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Order.acceptedOffer.identifier\":\"dummy-offer-id\"}}}]}
  }"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).

---

## 7) Legacy organization order poll (`Order/_batch-response`)

```bash
curl -sS -i -X POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_SECTOR/registry/org.schema/Order/_batch-response" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_ORG_ORDER\"}"
```

Expected: HTTP `202|200|500`, never `404 route not found`.

---

## 8) Create employee submit (`Employee/_batch`)

```bash
THID_EMP="thid-employee-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{
    \"thid\":\"$THID_EMP\",
    \"body\":{\"data\":[{\"type\":\"Employee-create-request-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Person.email\":\"doctor1@example.com\",\"org.schema.Person.hasOccupation\":\"ISCO-08|2211\"}}}]}
  }"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).

---

## 9) Create employee poll (`Employee/_batch-response`)

```bash
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch-response" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_EMP\"}"
```

Expected: HTTP `202|200|500`, never `404 route not found`.

---

## 10) Token exchange submit (`Token/_exchange`)

```bash
THID_EXCHANGE="thid-exchange-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_EXCHANGE\",\"subject_token\":\"dummy-license-code\"}"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).

---

## 11) Token exchange poll (`Token/_exchange-response`)

```bash
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange-response" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_EXCHANGE\"}"
```

Expected: HTTP `202|200|500`, never `404 route not found`.

---

## 12) Device DCR submit (`Device/_dcr`)

```bash
THID_DCR="thid-dcr-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Device/_dcr" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_DCR\",\"client_name\":\"web-portal-test\",\"jwks\":{\"keys\":[]}}"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).

---

## 13) SMART token submit (`smart/token`)

```bash
THID_SMART="thid-smart-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/smart/token" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{\"thid\":\"$THID_SMART\",\"scope\":\"individual.onboard\"}"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).

---

## 14) Family organization submit (`individual/.../Organization/_batch`)

```bash
THID_FAMILY="thid-family-$(date +%s)"
curl -sS -i -X POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.schema/Organization/_batch" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "{
    \"thid\":\"$THID_FAMILY\",
    \"body\":{\"data\":[{\"type\":\"Family-registration-form-v1.0\",\"meta\":{\"claims\":{\"@context\":\"org.schema\",\"org.schema.Organization.name\":\"Family Test\",\"org.schema.Person.email\":\"family@example.com\"}}}]}
  }"
```

Expected: HTTP `202` (or domain `4xx`, but route exists).

---

## Go/No-Go rule

GO if:

1. Ping is `200`.
2. None of the 14 calls returns route-level `404`.
3. Async calls return `202`/`200`/domain error, but not path-not-found.

NO-GO if:

1. Any required route returns path-level `404`.
2. Ping fails.
3. Tenant context (`tenantId/jurisdiction/sector`) does not match frontend profile.
