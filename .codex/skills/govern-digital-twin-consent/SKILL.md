---
name: govern-digital-twin-consent
description: Implement or audit the FHIR Consent, IPS projection, pseudonymous subject, disable and provider-offboarding contracts for Digital Twin flows across GW CORE and gdc-sdk-node-ts. Use for secondary-use permit or deny, HRESCH claims, stable Consent identifiers, individual Communication ingestion, direct digitaltwin Composition routes, twin urn:uuid validation, study-specific consent separation, materialization, purge, 101 docs, tests, SDK releases, or cleanup of erroneous research-index records.
---

# Govern Digital Twin Consent

## Read before acting

Read the current files in both repositories:

- GW CORE:
  - `AGENTS.md`
  - `docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md`
  - `docs/90.F-UC_CAPABILITY_MATRIX_SEDIA.md`
  - `src/utils/consent-storage.ts`
  - `src/utils/digital-twin-secondary-use.ts`
  - `src/utils/digital-twin-research-projection.ts`
- Node SDK:
  - `docs/101-DIGITAL_TWIN_SDK.md`
  - `tests/101-digital-twin-sdk.test.mjs`
  - `src/digital-twin.ts`
  - `src/resource-operations.ts`
  - `src/orchestration/individual-controller-sdk.ts`

Verify current branches, versions and published npm state before release claims.

## Preserve the application contract

- Accept only the product-level browser choice `{ enabled: boolean }`.
- Resolve the authenticated subject, index-provider organization and enrollment state in the BFF. Never accept them from browser JSON.
- Call `IndividualControllerSdk.setDigitalTwinSecondaryUseConsent(...)` with `decision: 'permit' | 'deny'`.
- Author one FHIR `Consent` through `resource.meta.claims` and `entry.meta.claims`:
  - `Consent.subject`: authenticated operational subject DID
  - `Consent.actor-identifier`: organization/tenant that provides the subject index
  - `Consent.actor-role`: `*`
  - `Consent.purpose`: `HRESCH`
  - `Consent.action`: canonical `ServiceCapability.DigitalTwinReader`
  - `Consent.decision`: `permit` or `deny`
- Do not add an ODRL attachment to this provider-level secondary-use Consent.
- Do not introduce `researchOrganizationDid` into the patient toggle. A future portal or study uses another FHIR Consent with its own identifier and actual research actor.

## Own the stable Consent identifier server-side

- Call `createDigitalTwinSecondaryUseConsentIdentifier()` exactly once in the server-side index-enrollment transaction.
- Persist the resulting random `urn:uuid` with that enrollment and reuse it for status, permit and deny.
- Never derive it from the subject DID, tenant DID, email or another personal identifier.
- Never return it to the browser or regenerate it per request.
- Backfill an existing enrollment once under an idempotent transaction; do not create duplicate portal rules.

## Keep projection separate from consent

- Ingest the operational IPS through the existing individual `Communication/_batch` flow, normally via `ingestCommunicationAndUpdateIndex(...)`.
- Let GW create or refresh the research projection when consent is `permit`.
- Create one canonical Composition per IPS document/version with all IPS sections. Never create one Composition per section.
- Assign the twin subject only inside GW from its tenant-private alias as a registered `urn:uuid:<uuid>`.
- Reject operational DIDs, caller-invented UUIDs and unregistered UUIDs on canonical research records.
- Never teach a patient portal to submit an IPS Bundle or canonical Composition to `digitaltwin/.../Composition/_batch`.
- Treat the direct Composition batch only as explicitly scoped adapter/compatibility plumbing for a pre-authorized registered twin; keep it outside the portal 101.

## Preserve lifecycle semantics

- `deny` is reversible disable: pause later synchronization, retain the private alias and freeze published anonymous data.
- A later `permit` reuses the alias and rebuilds from current operational data.
- `purgeDigitalTwinSubjectLink(...)` is provider offboarding only: delete the private operational-subject to twin correspondence, never anonymous research data.
- A later enrollment after purge receives a new twin UUID and cannot reconnect the old projection.
- Administrative cleanup of erroneous direct records must resolve the exact tenant, section, document ids and subject first. Delete only proven erroneous index records; do not represent cleanup as patient purge, and do not claim immutable audit anchors were erased.

## Keep every artifact aligned

For any contract change, update together:

- manager/utility tests and route integration tests in GW CORE;
- SDK JSDoc and exported types/functions;
- executable `tests/101-digital-twin-sdk.test.mjs` with comments that explain one-time server persistence;
- copyable snippets in `docs/101-DIGITAL_TWIN_SDK.md`;
- GW high-level lifecycle and SEDIA capability matrix;
- README public-surface inventory and changelogs;
- this skill in both repository-local copies.

Search for stale claims before finishing, especially `researchOrganizationDid`, `secondaryUseClaimKey`, ODRL in the provider toggle, operational `Composition.subject`, one Composition per section, and portal calls to direct digitaltwin Composition batch.

## Verification

- Run targeted GW consent, projection and Composition route tests plus typecheck/build/Swagger when the GW contract changes.
- Run SDK build, product-neutrality, typecheck, executable 101 and full tests when the SDK surface changes.
- Confirm branch, commit, push and merge state in each changed repository.
- For npm, verify `npm view <package>@<version>`, `dist.integrity`, `latest`, a clean install and the exported helper before declaring publication.
- For deployed cleanup or behavior, verify the actual CORE workload tuple; never confuse CORE development with GW UNID or SOSCHAIN.

