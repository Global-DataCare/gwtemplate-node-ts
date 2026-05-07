# TODO_ROADMAP (gwtemplate-node-ts)

Version:
- 0.1.0
- Date: 2026-04-08
- Source orchestrator: /Users/fernando/GITS/gdc-workspace/TODO_ROADMAP_ORCHESTRATOR.md

## Current status
- [ ] Pending repository-specific roadmap definition.
- [ ] Align auth actor terms: service-controller, tenant-controller, tenant-runtime-client.
- [ ] Link this file updates back to orchestrator chronology.
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
