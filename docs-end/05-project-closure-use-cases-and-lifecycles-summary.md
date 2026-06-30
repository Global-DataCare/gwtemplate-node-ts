# Project Closure Summary: Use Cases, Lifecycles, SDK Classes, and Local Reproducibility

## 1. Clarification About ICA VC Readers

Short answer: yes, there were already useful readers in `ica-client-sdk-ts`, but they were not the full shared answer for the GW `_transaction` / `_transaction-response` shape.

What already existed:

- [controllerBinding.ts](https://github.com/Global-DataCare/ica-client-sdk-ts/blob/main/src/controllerBinding.ts)
  - `findLegalRepresentativeCredentialEntry(...)`
  - `getLegalRepresentativeCredentialSubject(...)`
  - `extractRepresentativeBindingProjection(...)`
  - `normalizeControllerSameAs(...)`
  - `buildControllerCredentialMaterial(...)`

What those helpers solved:

- reading the legal representative VC from a direct ICA `_verify-response`
- extracting `credentialSubject.sameAs`
- extracting `credentialSubject.hasCredential.material`

What they did not solve cleanly for the whole stack:

- reading both `LegalOrganization` and `LegalRepresentative` from the GW host `_transaction-response`
- tolerating all current response shapes:
  - direct ICA `body.data[]`
  - nested `resource.icaResponse.body.data[]`
  - projected `vc[]`
- exposing one shared reader from `gdc-common-utils-ts` so `sdk-core`, `sdk-node`, live tests, and docs all teach the same thing

That is why the new shared readers were added in:

- [legal-organization-verification-result.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/utils/legal-organization-verification-result.ts)
- [bundle-reader.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/utils/bundle-reader.ts)

So the correct conclusion is:

- `ica-client-sdk-ts` already had part of the solution
- `gdc-common-utils-ts` now has the stack-wide reusable reader layer needed by GW + SDKs + docs

## 2. Canonical Package Split

| Package | Responsibility | Do not use it for |
| --- | --- | --- |
| `gdc-common-utils-ts` | constants, editors, readers, examples, claim helpers, lifecycle placeholders | direct HTTP runtime |
| `gdc-sdk-core-ts` | actor-neutral contracts, request builders, response readers, lifecycle snippets | app runtime orchestration |
| `gdc-sdk-node-ts` | backend/BFF runtime, submit/poll, actor SDKs, live E2E | infra bootstrap ownership |
| `gdc-sdk-front-ts` | frontend/native actor sessions and actor SDK access | backend-only process orchestration |
| `gwtemplate-node-ts` | GW CORE runtime, routes, managers, local infra/bootstrap owner | first teaching surface for transport wrappers |
| `ica-client-sdk-ts` | ICA request/response helpers and ICA-side VC/binding extraction | full GW host lifecycle |
| `dataspace-ica-ts` | ICA runtime and `.well-known` trust publication | tenant/business orchestration |

## 3. Main Public SDK Surfaces

| Actor / Layer | Main class or entrypoint | Repo |
| --- | --- | --- |
| Host onboarding | `HostOnboardingSdk` | `gdc-sdk-node-ts` |
| Organization controller | `OrganizationControllerSdk` | `gdc-sdk-node-ts` |
| Individual controller | `IndividualControllerSdk` | `gdc-sdk-node-ts` |
| Professional | `ProfessionalSdk` | `gdc-sdk-node-ts` |
| Frontend actor entry | `session.asHostOnboarding()`, `session.asOrganizationController()`, `session.asIndividualController()`, `session.asProfessional()` | `gdc-sdk-front-ts` |
| Legal org form/editor | `createLegalOrganizationOnboardingEditor()` | `gdc-common-utils-ts` |
| Individual onboarding editor | `createIndividualOnboardingFacade()` | `gdc-sdk-core-ts` / `gdc-common-utils-ts` |
| Shared GW claims reader | `getClaimsInFirstDataEntry(...)`, `getClaimsInBundleEntryAt(...)` | `gdc-common-utils-ts` |
| Shared legal verification VC readers | `readLegalOrganizationVerificationCredentialPairFromResponseBody(...)`, `readLegalOrganizationVerificationTaxIdFromResponseBody(...)`, `readLegalRepresentativeSameAsFromResponseBody(...)`, `readLegalRepresentativeBindingFromResponseBody(...)` | `gdc-common-utils-ts` |

## 4. Tenant / Legal Organization Lifecycle

### 4.1 Canonical New Flow

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Build verification request from PDF/form/KYC | controller/BFF | `createLegalOrganizationOnboardingEditor()` | `buildGatewayVerificationRequest(...)` |
| Submit legal verification | organization controller | `OrganizationControllerSdk` | `submitLegalOrganizationVerificationTransaction(...)` |
| Read ICA VCs and commercial offer | shared readers | `gdc-common-utils-ts` | `readLegalOrganizationVerificationCredentialPairFromResponseBody(...)`, `readCommercialOfferId(...)` |
| Confirm commercial order | host onboarding or org controller runtime path | `HostOnboardingSdk` / `OrganizationControllerSdk` | `confirmLegalOrganizationOrder(...)` or `confirmOrganizationLicenseOrder(...)` |
| Publish or bind tenant DID | organization controller | `OrganizationControllerSdk` | `submitOrganizationDidBinding(...)` |
| Disable tenant | organization controller | `OrganizationControllerSdk` | `disableTenant(...)` |
| Purge tenant | organization controller | `OrganizationControllerSdk` | `purgeTenant(...)` |

### 4.2 Legacy Legal Organization Flow

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Submit ICA proof directly | host onboarding | `HostOnboardingSdk` | `activateOrganizationInGatewayFromIcaProof(...)` |
| Read `org.schema.Offer.identifier` | shared claims reader | `gdc-common-utils-ts` | `getClaimsInFirstDataEntry(...)` or dedicated offer reader |
| Confirm order | host onboarding | `HostOnboardingSdk` | `confirmLegalOrganizationOrder(...)` |

### 4.3 Controller Recovery / Reissue

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Reissue controller activation | organization controller | `OrganizationControllerSdk` | `submitLegalOrganizationIssue(...)` |
| Exchange activation code | runtime | `NodeRuntimeClient` path behind actor SDKs | `Token/_exchange` |
| Register device/profile | runtime | `NodeRuntimeClient` path behind actor SDKs | `Device/_dcr` |

Technical slice only, not first public doc surface:

- `recoverOrganizationControllerWithIssueWithDeps(...)`

## 5. Employee / Professional Lifecycle

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Create employee/professional | organization controller | `OrganizationControllerSdk` | `createOrganizationEmployee(...)` |
| Search employees | organization controller | `OrganizationControllerSdk` | `searchOrganizationEmployees(...)` |
| Reserve/reissue seat | GW runtime route behind SDK | organization/employee lifecycle | `License/_issue` |
| Activate employee device profile | organization controller runtime | `OrganizationControllerSdk` | `activateEmployeeDeviceWithActivationRequest(...)` |
| Request SMART token | professional or org-scoped actor | `ProfessionalSdk` / `OrganizationControllerSdk` | `requestSmartToken(...)` |
| Disable employee | organization controller | `OrganizationControllerSdk` | `disableEmployee(...)` / `disableOrganizationEmployee(...)` |
| Purge employee and free seat | organization controller | `OrganizationControllerSdk` | `purgeEmployee(...)` / `purgeOrganizationEmployee(...)` |

Important business rule already closed:

- device replacement is not “new license”
- it is reuse/rebind of the same license seat when the same professional is reinvited

## 6. Individual Lifecycle

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Build individual bootstrap input | frontend/BFF/shared | `createIndividualOnboardingFacade()` | editor methods + final build |
| Start individual organization/bootstrap | individual controller | `IndividualControllerSdk` | `startIndividualOrganization(...)` |
| Search or reuse existing family/individual registration | individual controller | `IndividualControllerSdk` | `searchFamilyOrganization(...)`, `ensureFamilyOrganizationRegistration(...)` |
| Confirm commercial order | individual controller | `IndividualControllerSdk` | `confirmIndividualOrganizationOrder(...)` |
| Disable individual | individual controller | `IndividualControllerSdk` | `disableIndividual(...)` / `disableIndividualOrganization(...)` |
| Purge individual | individual controller | `IndividualControllerSdk` | `purgeIndividual(...)` / `purgeIndividualOrganization(...)` |

Important scope note:

- the old embedded/legacy registration path is not the normative onboarding path
- it should be treated as administrative compatibility only, not as full cryptographic controller onboarding

## 7. User Data Feed, Anonymization, and Digital Twin Lifecycle

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Import IPS or FHIR bundle | individual controller | `IndividualControllerSdk` | `importIpsOrFhirAndUpdateIndex(...)` |
| Ingest communication bundle/resources | individual controller or professional | `IndividualControllerSdk` / `ProfessionalSdk` | `ingestCommunicationAndUpdateIndex(...)` |
| Upsert `RelatedPerson` | individual controller | `IndividualControllerSdk` | `upsertRelatedPersonAndPoll(...)` |
| Generate digital twin from subject data | individual controller | `IndividualControllerSdk` | `generateDigitalTwinFromSubjectData(...)` |
| Search indexed compositions / twin data | individual controller or professional | `IndividualControllerSdk` / `ProfessionalSdk` | `searchClinicalBundle(...)` |

Narrative:

1. the individual controller first creates or confirms the subject space
2. then data is ingested
3. then the twin/composition layer is generated or refreshed
4. then authorized professionals query the twin and request IPS-oriented projections

## 8. Permission Lifecycle

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Grant professional access | individual controller | `IndividualControllerSdk` | `grantProfessionalAccess(...)` |
| Revoke professional access | individual controller | `IndividualControllerSdk` | `revokeProfessionalAccess(...)` |
| Search communication participants | individual controller or professional | `IndividualControllerSdk` / `ProfessionalSdk` | `searchCommunicationParticipants(...)` |
| Request SMART token after permission exists | professional | `ProfessionalSdk` | `requestSmartToken(...)` |

Non-negotiable dialogue order:

1. bootstrap tenant / employee / individual
2. ingest or prepare subject data
3. grant permission
4. request SMART token
5. read clinical bundle / IPS

Not the other way round.

## 8.1 Inter-Tenant SMART Contract Gate

Current closed scope for the closeout narrative:

- two distinct tenants may participate in one access agreement
- both tenants may be hosted by the same host/operator
- the host enforces policy and token issuance, but is not yet modeled as the
  semantic publisher of a host-aggregated `system/ResearchSubject.rs` scope

Canonical example:

- provider tenant: `acme-id` in `health-care`
- consumer tenant: `lab-id` in `health-research`

Sequence:

1. subject data exists under the provider tenant
2. subject-level permission/consent rules exist as usual
3. provider and consumer controllers sign one inter-tenant contract VC whose
   `credentialSubject` contains a FHIR `Contract`
4. the consumer professional presents the required access proof
   - in the current internal profile, this is one VP carrying the contract VC
   - in one external research profile, this may instead be one validated
     `Bearer data access token` from a platform such as Pontus-X
5. GW issues the SMART token only if:
   - the actor belongs to the consumer organization declared in the contract
   - the contract or external access proof is active/valid
   - the contract provider matches the token issuer tenant
   - the requested capability matches the allowed scope
   - the requested purpose matches the allowed purpose
6. after token issuance, the normal clinical read/search flow continues

Important modeling rule:

- the contract VC is the current internal inter-tenant authorization gate
- one external research token profile may replace that proof with a validated
  external `Bearer data access token`
- it does not replace subject consent
- it does not claim host-side aggregate digital twin publication

Coverage note for closeout:

- the executable GW integration flow currently proves the internal profile
  where the proof travels as one VP carrying the contract VC
- the external research-token profile is documented as an alternative
  integration shape, but it still requires dedicated TDD before it can be
  counted as code-proven behavior
- the minimum TDD slice for that external profile should include:
  - issuer/DID/JWKS trust resolution
  - token signature verification
  - alternative/exclusive proof selection versus `vp_token`

Additional closeout status update:

- the repository now also carries one explicit `local-network` audit chain for
  both SMART access planes:
  - `individual` clinical access via `organization/Composition.rs`
  - `digitaltwin` research access via `organization/ResearchSubject.rs`
- the research audit path now proves both:
  - employee inclusion/exclusion by role
  - employee inclusion/exclusion by direct email target
- the canonical live entrypoint is:
  - `scripts/project-audit-demo.sh`
  which chains:
  - `scripts/smoke-consentaccess-local-network.sh`
  - `scripts/smoke-consentaccess-lifecycle-local-network.sh`
  - `scripts/smoke-smart-access-local-network.sh`
  - allow/deny integration tests for `smart/token`

Contract semantics fixed for closeout:

- primary agreement object: VC containing `credentialSubject = FHIR Contract`
- controller signatures: VC `proof[]`
- signed agreement PDF/CID: `Contract.instantiatesUri`
- optional invoice/annexes: `Contract.supportingInfo`
- derived FHIR audit view: `Contract.relevantHistory` via `Provenance`

## 8.2 Canonical SDK Naming for Research Access

For project closeout and later 101 documentation, the canonical developer-facing
names are fixed as:

- `OrganizationControllerSdk`
- `DigitalTwinSdk`

Do not use `DigitalTwinControllerSdk` in closeout, justification, or future 101
material.

Responsibility split:

- `OrganizationControllerSdk`
  - formalize the inter-tenant agreement
  - submit or countersign the contract VC
  - grant provider-side and consumer-side authorization rules
  - manage later disable/revoke lifecycle
- `DigitalTwinSdk`
  - request the SMART access token with the current internal VP/carried
    contract VC or with the validated external research token profile
  - search digital twins
  - open/read IPS bundles
  - download one or more IPS results

Important scope note for the closeout narrative:

- the current GW repository proves the backend behavior and route contract
- the current didactic integration test already simulates both facades
- the real public `sdk-node` and `sdk-front` façade convergence remains a
  follow-up packaging task, not a backend gap

## 8.3 101 Teaching Sequence for New Developers

The high-level 101 flow that a developer should learn is now closed as
follows:

1. `OrganizationControllerSdk`
   - register or resolve provider tenant `acme`
   - register or resolve consumer tenant `lab`
2. `OrganizationControllerSdk`
   - formalize one inter-tenant contract VC
   - or at minimum obtain the already signed contract VC to be presented later
3. `OrganizationControllerSdk`
   - ensure provider-side permit rules exist for the target digital twins
   - optionally ensure consumer-side member delegation rules exist
4. `DigitalTwinSdk`
   - build one VP carrying the contract VC, or obtain one validated external
     research token when that integration profile is used
   - request one SMART access token from the provider tenant
5. `DigitalTwinSdk`
   - search `digitaltwin/.../Composition/_search` by text and section
6. `DigitalTwinSdk`
   - inspect one result and open the IPS
   - or select several results and download multiple IPS bundles

The canonical teaching example proven in the GW integration suite is:

- provider tenant `acme-id`
- consumer tenant `lab-id`
- provider subjects:
  - `Doraemon` with one IPS imported
  - `Novita` with medication-only demo bundles
- research searches:
  - `ibuprofen`
  - `paracetamol`

Expected observable behavior:

- searching `ibuprofen` returns exactly one digital twin
- searching `paracetamol` returns exactly one digital twin
- both matches resolve to the `Novita` subject
- the prior IPS import for `Doraemon` remains available and independently
  searchable/readable

## 8.4 What the 101 Must Make Explicit

To avoid newbie confusion, the 101 material in `gdc-sdk-node-ts` and
`gdc-sdk-front-ts` must make explicit:

- which data is collected in frontend forms
- which VC/VP material is built client-side versus backend-side
- which GW path each SDK method ultimately targets
- that smart-contract, queue, and storage plumbing remains inside GW CORE
- that `did:web` is used for public identity resolution, while the persisted
  authorization/ledger model uses canonical organization/member URNs
- that external research-token integrations should validate trusted issuers via
  configured DID/JWKS URLs instead of hardcoding one local public key

This closes the justification narrative without forcing frontend readers to
learn internal actor-specific runtime names first.

## 8.5 Frontend, BFF, Profile/Wallet, and GW Dialogue

For closeout, the high-level operational story should also be explained in the
same simple order used by frontend and BFF developers:

1. frontend forms and shared editors build the managed-user `Bundle`
2. depending on the role and use case, the BFF/runtime shapes the
   `Communication` that transports that bundle
3. the `profile/wallet` backend receives the authenticated managed-user payload
   and wraps it as a secure DIDComm message
4. the GW receives that message, verifies it, decodes it, processes it, and
   returns the response
5. the reverse path gives the frontend one response `Bundle`
6. the frontend reads that response with the shared bundle-reader layer

Important documentation rule for closeout:

- keep the business payload, the FHIR `Communication` shell, and the DIDComm
  transport envelope explained as three related but distinct layers
- do not collapse frontend, BFF/runtime, wallet, and GW responsibilities into
  one vague backend step
- keep `DigitalTwinSdk` visible as the developer-facing surface for the later
  research read/search flow after token issuance

## 9. Digital Twin Search and IPS Retrieval Lifecycle

| Step | Actor | Class / helper | Main method |
| --- | --- | --- | --- |
| Search twin / composition | professional / research consumer | `DigitalTwinSdk` as the documented 101 surface, backed by the current runtime implementation | `searchClinicalBundle(...)` |
| Read latest IPS | professional / research consumer | `DigitalTwinSdk` as the documented 101 surface, backed by the current runtime implementation | `getLatestIps(...)` |
| Read latest IPS from individual side | individual controller | `IndividualControllerSdk` | `getLatestIps(...)` |

Expected use:

- search one `Composition` or twin projection first when the UI needs section-aware discovery
- request IPS-style bundle after identifying the subject and allowed sections
- allow one or more sections depending on granted scopes and route input
- once the GW response comes back to the BFF/frontend path, reuse the same
  shared reader/editor surfaces instead of duplicating parsing logic per screen

Closeout naming rule:

- for research-access 101 material, teach this capability under `DigitalTwinSdk`
- current runtime code may still route through actor-specific SDK surfaces
- this avoids leaking backend actor-specific naming into the end-user research
  search narrative

## 10. Reproducible Local Stack

### 10.1 Workspace Repositories

```bash
mkdir -p "$HOME/GITS/gdc-workspace"
cd "$HOME/GITS/gdc-workspace"

git clone git@github.com:Global-DataCare/gdc-common-utils-ts.git
git clone git@github.com:Global-DataCare/gdc-sdk-core-ts.git
git clone git@github.com:Global-DataCare/gdc-sdk-node-ts.git
git clone git@github.com:Global-DataCare/gdc-sdk-front-ts.git
git clone git@github.com:Global-DataCare/ica-client-sdk-ts.git
git clone git@github.com:Global-DataCare/dataspace-ica-ts.git

# This repo currently points to an older remote name locally.
# Use the actual project repo URL agreed by the team for GW CORE.
git clone <gwtemplate-node-ts-repo-url>

# fabric-multicloud is expected as a sibling workspace folder for local devnet.
git clone <fabric-multicloud-repo-url>
```

### 10.2 Trust, PKI, and Identity Artifacts

Operational anchor:

- [25-trust-bundle-and-local-network-runbook.md](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/docs-v2/25-trust-bundle-and-local-network-runbook.md)

Main commands:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm run pki:bundle -- --config scripts/examples/trust-bundle.local.example.json
```

Useful explicit generators:

```bash
npm run pki:root
npm run pki:ica
npm run pki:host
npm run pki:member
```

Main scripts behind them:

- [generate-ica.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/generate-ica.ts)
- [generate-host.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/generate-host.ts)

Generated/public artifacts to audit:

- `did-<domain>.json`
- `jwks-<domain>.json`
- `x509.der`
- `x509-chain.der`
- `manifest.json`
- tenant/host published:
  - `/.well-known/did.json`
  - `/.well-known/legal-participant.vc.json`
  - `/.well-known/vc.json` as legacy alias

### 10.3 Local Fabric / Smart Contracts

Operational references:

- [24-local-audit-fabric-runtime.md](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/docs-v2/24-local-audit-fabric-runtime.md)
- `../fabric-multicloud/devnet/fabric-v3`

Canonical local command:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm run local:fabric:stack
```

Manual lower-level route:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm run prepare:local-fabric-env
npm run api:local-fabric
```

What this local stack is expected to bootstrap:

1. local Fabric devnet
2. local channels such as `identity-local` and `health-care-local`
3. local chaincode deploy wrappers
4. `.env.local-fabric`
5. GW CORE runtime
6. optional tenant bootstrap

### 10.4 Local ICA + GW + SDK Dialogue

From GW CORE / infra side:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm run api:local-demo
TENANT_ID=acme-id JURISDICTION=ES SECTOR=health-care HOST_NETWORK=test EMPLOYEE_COUNT=3 npm run demo:bootstrap-single-tenant
```

From SDK runtime side:

```bash
cd "$HOME/GITS/gdc-workspace/gdc-sdk-node-ts"
npm run test:e2e:live-full-cycle
```

For the full legal organization + ICA transaction path:

```bash
cd "$HOME/GITS/gdc-workspace/gdc-sdk-node-ts"
npm run test:e2e:live-gw:host-transaction:clean
```

For controller lifecycle only:

```bash
cd "$HOME/GITS/gdc-workspace/gdc-sdk-node-ts"
npm run test:e2e:live-controller-lifecycle
```

## 11. Actor Dialogue Order for Acceptance Tests

### Legal Organization

1. prepare signed legal PDF
2. build verification request from editor/form/KYC
3. submit `_transaction`
4. read ICA VCs + `OfferId`
5. confirm order
6. issue/recover controller if needed
7. exchange activation code
8. register controller device/profile
9. publish/bind DID
10. disable/purge only at end of lifecycle

### Professional

1. organization controller creates employee
2. seat is reserved or reissued
3. employee device registers
4. professional requests SMART token
5. professional reads clinical content
6. employee is disabled or purged when needed

### Individual

1. start individual bootstrap from signed PDF/form
2. confirm order
3. ingest data or create twin
4. grant professional access
5. professional requests SMART token
6. professional searches twin / IPS
7. revoke access if needed
8. disable/purge individual only at end

## 12. Minimum Acceptance Evidence

If the project closeout must be billable and defensible, the final handover should include:

| Evidence | Where it should come from |
| --- | --- |
| canonical SDK lifecycle docs | `gdc-sdk-core-ts`, `gdc-sdk-node-ts`, `gdc-sdk-front-ts` |
| GW CORE contract docs and OpenAPI | `gwtemplate-node-ts` |
| reproducible local trust/bootstrap runbook | `gwtemplate-node-ts/docs-v2/24-*` and `25-*` |
| live E2E proof | `gdc-sdk-node-ts/tests/101-live-full-cycle-bff-runtime.e2e.test.mjs`, `tests/101-organization-controller-lifecycle.live.test.mjs` |
| trust artifacts | `did.json`, `jwks.json`, `x509.der`, `legal-participant.vc.json`, `manifest.json` |
| smart contract / Fabric local proof | `npm run local:fabric:stack` + local smoke outputs |

## 13. Recommended Attachments for the Formal Closeout

1. This markdown exported to Word/PDF.
2. The BFF API table `v1.5`.
3. The local trust bundle and Fabric runbooks.
4. The live `101` E2E scripts and their logs.
5. One appendix with:
   - repo list
   - commands
   - generated public identity artifacts
   - lifecycle dialogue order by actor
