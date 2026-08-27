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
- `Consent.source-reference`: stable portal/software/study URL or URI
- Do not add an ODRL attachment to this provider-level secondary-use Consent.
- Do not introduce `researchOrganizationDid` into the patient toggle. Distinguish each portal, software product or study with its own `Consent.source-reference`.

## Resolve the Consent from its application/study reference

- The BFF passes `researchUseReference`, a stable URL or URI identifying its portal, software product or study.
- GW resolves the rule by subject, index provider, HRESCH, DigitalTwinReader and `Consent.source-reference`.
- GW alone assigns and reuses the internal `Consent.identifier`; the BFF never generates, stores, sends or receives it.
- Reusing the same source reference updates one rule. A different source reference creates a separate FHIR Consent.
- Status lookup must include active deny rules; "active" is validity/period state and must not be confused with `decision=permit`.

## Keep projection separate from consent

- Ingest the operational IPS through the existing individual `Communication/_batch` flow, normally via `ingestCommunicationAndUpdateIndex(...)`.
- Let GW create or refresh the research projection when consent is `permit`.
- Absence of an explicit permit is disabled; never project by default.
- Create one canonical Composition per IPS document/version with all IPS sections. Never create one Composition per section.
- Assign the twin subject only inside GW from its tenant-private alias as a registered `urn:uuid:<uuid>`.
- Reject operational DIDs, caller-invented UUIDs and unregistered UUIDs on canonical research records.
- Never teach a patient portal to submit an IPS Bundle or canonical Composition to `digitaltwin/.../Composition/_batch`.
- Treat the direct Composition batch only as explicitly scoped adapter/compatibility plumbing for a pre-authorized registered twin; keep it outside the portal 101.

## Preserve MVP discovery and organization authorization

- Basic search accepts one or more IPS section tokens, inclusive `date-from`,
  optional inclusive `date-to`, and non-empty `text`.
- Sections use OR. Text and date use AND and must match the same clinical
  resource. Resolve an omitted end date to GW current time.
- A section may map to several resource families. Never require the BFF to
  choose or know a resource type for basic search.
- Build private derived text/date/language search fields during projection;
  never expose them in search matches or materialized resources.
- Keep age range and host-wide aggregation out of the MVP.
- Same-tenant access uses verified employee proof. Foreign access also needs a
  matching FHIR Contract VC and provider authorization.
- Emit signer roles `provider-authorized-signatory` and
  `consumer-authorized-signatory`; accept `provider-controller` and
  `consumer-controller` only as deprecated read aliases.
- Require two already-verified `contractAgreement` proofs over the same
  immutable Contract VC. `RESPRSN` proves technical tenant control, not legal
  authority to sign, unless a separate verified delegation explicitly grants it.

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
- executable `tests/101-digital-twin-sdk.test.mjs` showing that the BFF stores only its stable research-use reference;
- copyable snippets in `docs/101-DIGITAL_TWIN_SDK.md`;
- GW high-level lifecycle and SEDIA capability matrix;
- README public-surface inventory and changelogs;
- this skill in both repository-local copies.

Search for stale claims before finishing, especially `researchOrganizationDid`, `secondaryUseClaimKey`, ODRL in the provider toggle, operational `Composition.subject`, one Composition per section, and portal calls to direct digitaltwin Composition batch.

## Verification

- Run targeted GW consent, projection and Composition route tests plus typecheck/build/Swagger when the GW contract changes.
- Run SDK build, product-neutrality, typecheck, executable 101 and full tests when the SDK surface changes.
- Confirm branch, commit, push and merge state in each changed repository.
- For npm, verify `npm view <package>@<version>`, `dist.integrity`, `latest`, a clean install and the exported public surface before declaring publication.
- For deployed cleanup or behavior, verify the exact target runtime tuple and
  never infer product identity from a legacy project, cluster or workload name.
