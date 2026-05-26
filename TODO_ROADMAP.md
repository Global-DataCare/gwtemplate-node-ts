# TODO_ROADMAP (gwtemplate-node-ts)

Version:
- 0.1.0
- Date: 2026-04-08
- Source orchestrator: $HOME/GITS/gdc-workspace/TODO_ROADMAP_ORCHESTRATOR.md

## Current status
- [ ] Pending repository-specific roadmap definition.
- [ ] Align auth actor terms: service-controller, tenant-controller, tenant-runtime-client.
- [ ] Link this file updates back to orchestrator chronology.
- [ ] Complete ICA-aligned lifecycle `v1` for suspend/deactivate semantics:
  - `disable` in GW must mean operational suspension, not purge and not license release.
  - suspended `employee`, `individual`, and `tenant` records must remain auditable and reactivatable.
  - employee seat/license remains suspended/reserved while the identity is suspended unless ICA/ledger state explicitly changes.
  - GW must not locally invent credential revocation; authoritative VC `credentialStatus` changes belong to ICA/ledger.
  - define host/portal `/_deactivate` flow as the canonical entry point for ICA-backed suspension/revocation updates.
  - keep `purge` as an internal retention/admin concern, never the normal public lifecycle.
- [ ] Add `/_deactivate` documentation and tests for ICA-driven status updates:
  - host receives ICA evidence/status update for organization, legal representative, employee, or individual.
  - GW persists local suspended state without deleting historical DID/DCR/license artifacts.
  - verifiers and portal flows must read authoritative `credentialStatus` from ICA/ledger, not infer it only from local GW status.
- [ ] Implement cross-operator/cross-ICA catalog aggregation (CA/operator plane):
  - discover ICA endpoints by jurisdiction/policy
  - discover node-operator offerings
  - aggregate tenant service offerings
  - filter by service offering/capability/jurisdiction
- [ ] Publish normalized catalog/discovery API contract for portal/backend consumers.
- [ ] Document and enforce auth-plane separation in GW docs/contracts:
  - transport-plane credential (HTTP/API gateway) is not user identity
  - `_exchange` belongs to identity activation flow only
  - `_exchange` must not be used as catalog/discovery credential
- [ ] Evaluate/add intermediate and future secure message profiles:
  - optional standalone signed-only request profile (DIDComm signed without encryption) if required by policy.
  - CBOR-based transport/profile option in addition to current FAPI JAR/JARM `request=<jws/jwe>` / `response=<jws/jwe>`.
  - keep compatibility matrix explicit by `SECURITY_MODE` (`strict|compat|demo`) and content-type.
- [ ] Unify canonical API examples across GW, tests, scripts, and SDKs:
  - keep request/response fixtures in shared JSON example files (single source of truth).
  - tests and demo scripts should load fixtures and override only runtime fields (`thid`, `subject`, timestamps, ids).
  - expose the same fixtures to SDK repositories to avoid contract drift.
  - map fixtures to OpenAPI/docs generation so examples are test-proven.
