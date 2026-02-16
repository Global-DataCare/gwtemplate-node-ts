# Family API Integrators Guide

This guide is the Family-specific integration profile for the gateway.

It reuses common security, DID, and async/poll patterns defined in:
- `docs/API_INTEGRATORS_GUIDE.md`

## 1. Scope

This document focuses on:
- Provider discovery for Family apps (operator-first).
- Family Organization onboarding (`individual/org.schema/Organization`).
- Relationship/member bootstrap after the family is created.

## 2. Step 1 (Mandatory): Discover Providers From Operator Catalog

Before creating a family in a provider, the app must resolve the provider list from known operator DIDs.

Runtime contract:
- Input: `FAMILY_OPERATOR_DIDS` configured in the app environment.
- Per operator DID:
  1. Resolve DID Document.
  2. Read `CatalogService.serviceEndpoint`.
  3. Call DSP catalog request endpoint.
  4. Parse canonical DSP `dcat:Catalog` (DCAT/ODRL JSON-LD).

Backend endpoints (DCAT-3 binding used in this project):
- `POST /dcat3/catalog/request`
- `GET /dcat3/catalog/datasets/{id}`
- Hosted tenant form:
  - `POST /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dcat3/catalog/request`
  - `GET /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dcat3/catalog/datasets/{id}`

Notes:
- Dataset `id` is a dataset identifier, not a hardcoded `"providers"` keyword.
- Filtering is submitted in request body as `filters` (project contract), for example:
  - `filters.sector`
  - `filters.jurisdiction`

## 3. Step 2: Create Family Organization In Selected Provider

Once a provider is selected from catalog discovery, create the family under that provider:
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch`

Then complete the Offer/Order handshake:
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch`

Reference payloads and full flow:
- `docs/API_INTEGRATORS_GUIDE.md` section `8.2 Step 6: Register a Family Organization`.

## 3.1. Swagger `/api-docs` Testing Notes

Family flows use the same Swagger helper described in `docs/API_INTEGRATORS_GUIDE.md` (`Global Flow Context`).

Recommended for repeated tests:
- Set `tenantId`, `sector`, and `jurisdiction` in the panel before executing Family endpoints.
- Use a unique `test id` per run so all `jti/thid` templates become unique (`...-<test-id>`).
- Keep `tax id` unique per registration attempt (default pattern is `TaxNumber-<tenantId>`).

## 4. Why This Is First

The unified data index of the person is managed in the Family domain (role `ONESELF` and related controllers).
Therefore, provider selection via operator catalog is the first action before creating the family organization.

## 5. Swagger Organization

Swagger should expose Family-focused endpoints separately from Organization onboarding.
Recommended tags:
- `Family Discovery`
- `Family Onboarding`
- `Organization Onboarding`

In this codebase, catalog discovery endpoints are documented under the Family/Discovery tags, while common security and async contracts remain shared in the main guide.
