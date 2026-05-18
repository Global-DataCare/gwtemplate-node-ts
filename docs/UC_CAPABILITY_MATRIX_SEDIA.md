# UC Capability Matrix

Purpose: single source of truth for implemented capabilities and missing SDK methods/classes, with mandatory full-flow coverage.

## Core Rule

For each resource/case, test chain must cover:
1. `create/activate` (or ingest)
2. `poll/read/list`
3. `update/revoke/deactivate` (when applicable)

## Capability Matrix (Implemented vs Missing)

| Resource/Domain | Create/Activate (status) | Search/Read/List (status) | Update/Add (status) | Missing methods/classes to add |
|---|---|---|---|---|
| Organization (schema.org) | Implemented in GW + SDK (`activateOrganizationInGatewayFromIcaProof`) | Partial (poll/read via generic helpers) | Partial (order confirmation exists, no explicit SDK class API surface) | `organization.create/activate/read/list/update` class namespace |
| Person/Employee (schema.org) | Implemented (`createOrganizationEmployee`) | Partial (poll/read via generic helpers) | Missing explicit update/deactivate | `employee.create/read/list/update/deactivate`, `employee.createWithInvitation` |
| Device/Identity/Auth | Implemented (`activateEmployeeDeviceWithActivationCode`, token exchange flows) | Implemented (token/poll helpers) | Partial (no explicit rotate/revoke methods) | `device.dcr`, `keys.register`, `exchange.token` namespaces as explicit methods |
| RelatedPerson (FHIR) | Implemented in GW (`RelatedPerson/_batch`) | Partial in SDK (path helpers exist, no typed helper) | Missing explicit update/add-contact helper | `relatedPerson.create/search/list/update`, `relatedPerson.addContact` |
| Consent (FHIR + flat claims) | Implemented create flow (`grantProfessionalAccessSimple`) | Missing explicit list/scope-check API | Missing explicit atomic-rule API | `consent.addRule`, `consent.list`, `consent.scopeCheck`, `consent.updateRule`, `consent.revokeRule`, `consent.accessRequest` |
| Communication (FHIR + flat claims) | Implemented (`ingestCommunicationAndUpdateIndex`) | Partial (poll via generic helper, no message namespace) | Missing explicit update/add payload API | `message.send`, `message.poll`, `message.list`, `communication.addPayload`, `communication.addNote` |
| Composition/Bundle search (FHIR) | Implemented ingestion and `_search` | Implemented (`Bundle/_search` submit+poll) | Partial (no explicit SDK update helper for sections) | `composition.search`, `composition.updateSections`, `index.references.upsert` |
| IPS/Unified document generation | Implemented (`importIpsOrFhirAndUpdateIndex`, `generateDigitalTwinFromSubjectData`) | Partial (retrieval through composition search) | Missing explicit regenerate/patch APIs | `document.generate`, `document.fetch`, `document.regenerate` |
| Licenses/Tenant config | Missing explicit SDK methods | Missing | Missing | `tenant.updateLicenses`, `licenses.listAvailable` |
| Audit/Evidence | Missing explicit SDK methods | Missing | Missing | `evidence.register`, `audit.events` |

## Claim Model Requirement (all resources)

For every resource type (schema.org and FHIR):
1. accept flat interoperable claims as canonical SDK input;
2. support conversion to target FHIR version/resource shape when needed;
3. keep original resource and keep/derive `meta.claims`;
4. support roundtrip extraction from resource back to flat claims.

## Mandatory E2E Flow Coverage

Each resource must have tests for:
1. create/activate/ingest;
2. poll/read/list/search;
3. update/add/revoke/deactivate.

If step 3 is not implemented, it must be explicitly marked as `missing` in this matrix and covered by pending TDD tasks.
