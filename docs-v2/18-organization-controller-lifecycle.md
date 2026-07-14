# 18 Organization Controller Lifecycle

> 101 note
> - This is the current narrow GW lifecycle `101` in `docs-v2`.
> - Start the self-managed user story upstream with `login -> loadProfile -> actor facade`, then use this file for the GW route/lifecycle contract.
> - Read [101-README.md](./101-README.md) for the ordered current path.

Purpose:

- describe the narrow GW lifecycle for the **organization controller**,
- keep the recovery/rebind contract explicit,
- explain both the direct GW route sequence and the preferred SDK-driven proof.

This document is intentionally narrower than the broader onboarding and
integrator guides.

Current user-story boundary:

- controller profile load/session bootstrap lives upstream in
  `gdc-sdk-node-ts`
- this file begins after that point and focuses only on GW lifecycle semantics

It covers only:

1. host onboarding,
2. optional seat expansion after the original registration,
3. `Organization/_issue`,
4. `Token/_exchange`,
5. `Device/_dcr`,
6. tenant disable,
7. tenant purge.

It does not cover:

- employee lifecycle,
- professional SMART/read flows,
- dialogue/consent,
- individual subject lifecycle.

## Core Rule

`Organization/_issue` is a recovery/rebind step for an **existing tenant**.

It must:

- refresh ICA-backed legal verification,
- reissue one activation code for the current controller,
- preserve already contracted seats,
- preserve seats bought after the original registration,
- avoid creating a new `Offer`,
- avoid requiring `Order/_batch`.

That recovery/rebind step must happen **before** tenant disable/purge when the
goal is to prove that the current controller can enroll the current device
again.

## Starting Points

There are two valid organization onboarding starts.

### Canonical host onboarding

1. `Organization/_transaction`
2. `Order/_batch`

### Legacy compatibility onboarding

1. external ICA proof (`vp_token`)
2. `Organization/_activate`
3. `Order/_batch`

After either start, the tenant exists and the controller can continue with the
recovery/rebind proof.

## Direct GW Route Sequence

### A. Refresh the existing tenant verification

Submit:

`POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue`

Poll:

`POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue-response`

Expected result:

- refreshed ICA response,
- refreshed claims,
- controller activation code in
  `org.schema.IndividualProduct.serialNumber`.

### B. Exchange the controller activation code

Submit:

`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange`

Poll:

`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response`

Input rule:

- use the controller `id_token`,
- use the activation code returned by `_issue`.

Expected result:

- `initial_access_token`

### C. Register the current device/app again

Submit:

`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr`

Poll:

`POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response`

Input rule:

- use the `initial_access_token`,
- pass the DCR payload,
- include the activation code in `body.code`.

Expected result:

- `client_id`

### D. Then teardown the tenant

Submit:

- `Organization/_disable`
- `Organization/_purge`

Use the same organization lifecycle locator (`identifier.value` / `taxID`)
that identifies the tenant.

## What Must Be True Before Teardown

Before disable/purge, check all of these:

1. `_issue` returned the controller activation code.
2. `_exchange` returned the `initial_access_token`.
3. `_dcr` returned the `client_id`.
4. the seat inventory after `_issue` still matches the expanded contracted
   inventory from before `_issue`.

If step 4 fails, the bug is not only “frontend recovery”; it is a lifecycle or
licensing regression.

## Preferred Consumer Proof

The preferred reproducible proof is not a curl collection. It is the public
Node SDK lifecycle contract:

- [gdc-sdk-node-ts/docs/101-ORGANIZATION_CONTROLLER_LIFECYCLE.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-ORGANIZATION_CONTROLLER_LIFECYCLE.md)

That proof uses:

- `OrganizationControllerSdk.submitLegalOrganizationVerificationTransaction(...)`
- `HostOnboardingSdk.activateOrganizationInGatewayFromIcaProof(...)`
- `OrganizationControllerSdk.confirmOrganizationLicenseOrder(...)`
- `OrganizationControllerSdk.submitLegalOrganizationIssue(...)`
- `recoverOrganizationControllerWithIssueWithDeps(...)`
- `OrganizationControllerSdk.disableTenant(...)`
- `OrganizationControllerSdk.purgeTenant(...)`

The authoritative executable test there is:

- `gdc-sdk-node-ts/tests/101-organization-controller-lifecycle.test.mjs`

That test proves both:

- canonical `_transaction` onboarding,
- legacy `_activate` onboarding,

and in both cases proves:

- `_issue -> _exchange -> _dcr`,
- controller-seat reuse,
- preservation of post-registration seat expansions,
- final disable/purge ordering.

## GW Boundary

GW owns:

- the host routes,
- the async job contracts,
- the tenant lifecycle semantics,
- the seat preservation behavior during `_issue`.

`gdc-sdk-node-ts` owns:

- the reproducible consumer flow,
- the typed public facade sequence that integrators can copy into a BFF.

## Related Docs

- [09-api-integrators-guide.md](./09-api-integrators-guide.md)
- [10-host-organization-activate.md](./10-host-organization-activate.md)
- [16-deactivation-and-purge-lifecycle.md](./16-deactivation-and-purge-lifecycle.md)
- [99-migration-map-from-docs.md](./99-migration-map-from-docs.md)
