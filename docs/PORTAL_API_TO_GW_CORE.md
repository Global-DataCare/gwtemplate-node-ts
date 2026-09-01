# Portal API To GW CORE

Status: Canonical cross-repository functional reference for portal-facing API
design over GW CORE.

This is the only maintained portal/API mapping in this repository. The root
[`portal-api-gw.md`](../portal-api-gw.md) file is a navigation pointer, not a
second contract. Product portals keep their exhaustive concrete route
inventory beside their code and classify every route as a CORE facade, portal
infrastructure, or a domain extension.

Use this document when you need to define or review:

- portal/BFF endpoint shape
- the functional mapping from portal APIs to GW CORE operations
- the separation between `employees`, `related persons`, `members`, and
  `consents`
- which concerns belong to the portal backend instead of the browser/mobile app

This document is intentionally portal-facing and integration-facing.
It does not replace lower-level SDK or GW route documentation.

This is a generic facade design, not the route inventory of one deployed
portal. Each domain adapter must maintain its concrete BFF table beside its
code and map every row back to this functional contract.

Public BFF paths are named after the governed aggregate or authority. Use
`/subject`, `/organizations`, `/employees`, `/licenses` and `/research`;
reserve `/host/...` for host-operator authority and `/test-network/...` for
Test Network admission and governance. Deployment-specific compatibility
aliases remain outside this CORE contract.

Read the visual GW execution model first in
[`01.I-GW-CORE-CONTRACT-MAP.md`](01-OVERVIEW-AND-GUIDES/01.I-GW-CORE-CONTRACT-MAP.md);
the table below says *what* a portal facade exposes, while that map explains
*how* actor identity, asynchronous transport, internal dispatch and exact
readback work.

## Scope

This table describes what it makes sense to expose from a portal backend.

It does not require the frontend to know about:

- DIDComm wrapping
- submit/poll internals
- KMS signing
- transport-level GW route variants

Readback rule:

- every write/use-case step must have one user-facing readback step
- after a controller confirms one paid offer, the web app must be able to read
  the updated order/license state with high-level readers or bundle/read-model
  helpers
- that readback can be implemented later in a `job manager` or portal cache
  layer, but the functional contract belongs here from the start

When helpful, the last column states what the portal backend does against GW
CORE behind the scenes.

Search readers consume one primary resource per outer Bundle entry. Portal and
BFF code should call the shared high-level SDK reader, which accepts both the
current shape and the deprecated rolling-deployment shape; it must not inspect
`resource.data` or construct DIDComm transport envelopes itself.

## Organizations

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/organizations/{uuid}/verification-transaction` | `POST` | submit signed legal evidence, controller binding key, and legal claims before tenant activation | calls the host-side `Organization/_transaction` route and polls until ICA verification data is available |
| `/organizations/{uuid}/verification-transaction/{requestId}` | `GET` | retrieve the asynchronous legal-verification status/result | reads the portal-stored state or the projected `Organization/_transaction-response` result |
| `/organizations/{uuid}/activate-tenant` | `POST` | activate a legal organization in GW from an ICA proof / `vp_token` | calls the GW host activation flow and waits for the result |
| `/organizations/{uuid}/activate-tenant` | `GET` | retrieve activation status/result | reads the status persisted by the portal |
| `/organizations/{uuid}/did-binding` | `POST` | replace the organization public DID aliases (`alsoKnownAs`) once the legal onboarding already exists | calls the published tenant route `did/document/_binding` and polls `did/document/_binding-response` through the SDK |
| `/organizations/{uuid}/did-binding` | `GET` | read the current public DID binding/aliases of the organization | resolves the current DID document view and its `alsoKnownAs` aliases from the hosted/provider projection |
| `/organizations/{uuid}/license-offers` | `POST` | request an offer to buy/add more licenses | calls the organization-controller facade `requestEmployeeLicenseOffer(...)`; the configured payment adapter remains a BFF concern |
| `/organizations/{uuid}/license-offers` | `GET` | list license offers known by the portal | calls the organization-controller Offer reader and projects authoritative state |
| `/organizations/{uuid}/license-offers/{offerId}` | `GET` | get one license offer detail | returns known price, quantity, currency, and state |
| `/organizations/{uuid}/license-orders` | `POST` | request purchase/addition of more licenses | verifies payment through the configured BFF adapter and calls `confirmOrganizationLicenseOrder(...)` for the accepted Offer |
| `/organizations/{uuid}/license-orders` | `GET` | list license purchases launched from the portal | calls the organization-controller Order reader and projects authoritative state |
| `/organizations/{uuid}/license-orders/{orderId}` | `GET` | get one purchase status | returns the status materialized by the portal |
| `/organizations/{uuid}/license-orders/{orderId}/payment-confirmation` | `POST` | confirm payment for a license purchase so seats can be emitted | in portal-managed mode the BFF receives the Stripe or other provider confirmation, then submits one `Order`-style confirmation to GW CORE so seats are emitted from the accepted offer |
| `/organizations/{uuid}/licenses` | `GET` | list visible organization seats/licenses | calls the SDK organization-controller license reader, backed by tenant `entity/org.schema/License/_search`, and projects the returned seats/devices for the UI |
| `/organizations/{uuid}/orders` | `POST` | confirm the legal-organization offer/license | sends the organization order to GW |
| `/organizations/{uuid}/orders` | `GET` | list orders launched from the portal | reads portal-stored order history |
| `/organizations/{uuid}/orders/{orderId}` | `GET` | get one order detail | returns portal-materialized order state |
| `/organizations/{uuid}/employees` | `POST` | create employees/professionals | uses the organization-controller SDK to submit `Employee/_batch`, reserve the existing seat through the canonical identity issue operation, and return its activation credential |
| `/organizations/{uuid}/employees` | `GET` | list employees/professionals visible to the portal | uses portal storage or a materialized read model |
| `/organizations/{uuid}/employees/{employeeId}` | `GET` | get one employee/professional detail | returns the known employee detail |

## Portal Technical Identity

These operations are normally internal to the portal backend, not frontend
calls.

| Internal operation | Purpose |
|---|---|
| activation code exchange | exchange an activation code for an initial credential |
| device activation / DCR | register the portal backend JWK/public key as the actor technical device |
| SMART token | obtain an operational token with protected scopes |

## Subject / Individual Onboarding

`individual` is the neutral aggregate. A domain-specific demographic
specialization does not change the lifecycle: individual Organization start,
Offer, Order, exchange and controller DCR. A professional credential may
authorize an assisted channel to start this flow, but it does not itself become
controller authority for the created subject.

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/onboarding-fill` | `POST` | send PDF template + fields and receive the populated PDF | calls the onboarding PDF `DocumentReference/_create` flow |
| `/subject/onboarding-fill/{requestId}` | `GET` | retrieve the populated PDF or latest result | reads the resulting `DocumentReference` or portal cache |
| `/subject` | `POST` | register the individual organization and start onboarding | sends the individual start flow to GW |
| `/subject` | `GET` | list every subject owned by the authenticated account across browsers | queries GW by exact verified `Organization.owner.email`/`owner.telephone`, then merges delegated license/binding candidates; browser storage may choose a returned card but is never the directory |
| `/subject/{subjectId}` | `GET` | get one subject detail | returns portal-known subject detail |
| `/subject/license-offers` | `POST` | request an offer to buy/add licenses for the individual/family context | today the portal must orchestrate this as its own capability; GW does not yet expose one converged public route for this |
| `/subject/license-offers` | `GET` | list personal license offers known by the portal | uses commercial/materialized history |
| `/subject/license-offers/{offerId}` | `GET` | get one personal offer detail | returns known price, quantity, currency, and state |
| `/subject/license-orders` | `POST` | request purchase/addition of more licenses for the individual/family context | conceptually triggers `offer -> order -> payment`; the portal must orchestrate it today |
| `/subject/license-orders` | `GET` | list personal license purchases launched from the portal | uses commercial/materialized history |
| `/subject/license-orders/{orderId}` | `GET` | get one personal purchase status | returns the portal-materialized state |
| `/subject/license-orders/{orderId}/payment-confirmation` | `POST` | confirm payment for a personal license purchase so seats can be emitted | today the portal must close this with its commercial backend and then trigger internal GW creation of new `device-licenses` |
| `/subject/onboarding-confirm` | `POST` | confirm the onboarding order/offer | sends the subject order to GW |
| `/subject/onboarding-confirm/{confirmationId}` | `GET` | retrieve confirmation status/result | reads the portal-stored status |

## Subject Orders

The functional logic is the same as for legal organizations:

- first there is a start/registration step returning an offer
- then the order is confirmed by accepting that offer

What changes is the verification/preparation step before the start:

- signed PDF
- or an OTP/backend flow

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/orders` | `POST` | confirm the subject onboarding offer when the frontend already has `offerId` | sends the individual order flow to GW |
| `/subject/orders` | `GET` | list subject orders known by the portal | uses portal-stored history |
| `/subject/orders/{orderId}` | `GET` | get one individual order detail/status | returns the portal-materialized state |
| `/subject/licenses` | `GET` | list visible licenses/seats for the individual/personal organization context | uses the individual-controller SDK license reader backed by `individual/org.schema/License/_search` |

## IPS And Clinical Read

All clinical subject-index input and output crosses the GW boundary as an
auditable `Communication`. `Subject/$summary`, `Subject/_search` and
`Bundle/_search` are operation references resolved inside GW, not routes that
new BFF code constructs directly. See
`docs/01-OVERVIEW-AND-GUIDES/01.I-GW-CORE-CONTRACT-MAP.md`.

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/ips-requests` | `POST` | request full IPS or IPS with selected sections | calls the actor facade `requestClinicalSummary(...)`, which sends `Communication/_batch` carrying the internal `Subject/$summary` operation reference |
| `/subject/ips-requests` | `GET` | list IPS requests launched from the portal | uses portal history/audit |
| `/subject/ips-requests/{requestId}` | `GET` | get one IPS request and its result | reconstructs it from `Communication` or local cache |
| `/subject/ips` | `GET` | retrieve the latest IPS view for rendering | returns the authoritative Bundle obtained through `requestClinicalSummary(...)`; it does not call `Subject/$summary` directly |
| `/subject/clinical-bundle/search` | `POST` | run a specialized index query when the summary is not enough | compatibility/specialized facade; the runtime may currently use direct `Bundle/_search`, but this is not the primary subject read contract |
| `/subject/documents` | `GET` | list subject clinical/documents | retrieves `DocumentReference` and projections |
| `/subject/documents/{documentId}` | `GET` | get one document detail | returns `DocumentReference` or a resolved document view |

## Access Consents

If documentary evidence belongs to a consent flow, the frontend should retrieve
it from the consent aggregate, not from a separate document collection.

Important:

- `Consent` models effective access permissions
- it must not be confused with `RelatedPerson`
- one `RelatedPerson` may coincide with an authorized actor, but that does not
  grant access by itself
- disabling a `RelatedPerson` does not currently imply automatic revocation of
  already granted permissions

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/access-consents` | `POST` | create an access consent / pre-authorization | sends a typed Consent Bundle attached to `Communication`; direct `Consent/_batch` is lower-level compatibility plumbing |
| `/subject/access-consents` | `GET` | list consents with associated evidence | reconstructs a portal-side aggregate from storage/audit |
| `/subject/access-consents/{consentId}` | `GET` | get one consent detail with original evidence | returns the consent aggregate plus evidence/references |

## Reusable Subject and Controller Identity Evidence

This is the common Next.js BFF contract for subject and controller evidence.
It is intentionally written in product-neutral terms. A domain extension may
change labels, supported subject fields and evidence policy, but it must not
replace these authorization or evidence semantics with browser logic.

For a new developer, the flow is:

1. The signed-in account asks the BFF for subjects it is currently authorized
   to control. Email and telephone are login locators, not controller proof.
2. The person selects one returned subject. Editing the subject opens the
   existing person or animal card-management flow.
3. The BFF returns the controller's independently evidenced identifiers. One
   controller can have several, for example a Spanish national identifier, a
   British Columbia driver licence and a passport.
4. The user chooses which identifier the new evidence concerns and uploads a
   PDF. The uploader, every signer and the trusted verifier are separate audit
   actors.
5. The BFF calls one high-level Node actor-facade method. It never authors
   DIDComm, FHIR batches, claim paths or signature-validation plumbing in the
   route handler.
6. Only authoritative readback may show `verified`. Browser selection, upload
   completion or a local digest never changes verification status.

Identity storage is claims-first but not FHIR-identity claims. Each evidenced
identifier is one semantic `Person` entry in the neutral `Subject` collection,
linked to the same public card through `org.schema.Person.sameAs`. Therefore a
controller with DNI, passport and driver licence has three associated `Person`
identity entries; adding one never overwrites the others. The canonical flat
projection lives in `resource.meta.claims`, for example:

```ts
{
  "org.schema.Person.identifier.additionalType":
    "org.hl7.terminology.CodeSystem.v2-0203.NN",
  "org.schema.Person.addressCountry": "ES",
  "org.schema.Person.addressRegion": "ES-CT",
  "org.schema.Person.identifier.value": "<protected value>",
  "org.schema.Person.sameAs": "<stable card URI>"
}
```

The UI does not author those string keys. It calls the typed frontend facade;
the SDK maps its model to and from flat `resource.meta.claims`. FHIR R4/R5 or
other interoperability resources are projections/adapters and do not replace
the canonical identity association.

Do not confuse reverse-DNS coding values and Schema.org claim prefixes with
FHIR claim names. Identity uses `org.schema.Person.*`; a FHIR-like Observation
uses governed resource-qualified claims such as `Observation.subject`,
`Observation.code` and `Observation.value-quantity-value`.

The first implemented provider route is `/api/identity-evidence`. It is a
product extension, not a new GW CORE endpoint. A downstream portal may proxy it
through a fixed provider route while preserving the same request and response
shapes.

| Portal API | Method | Frontend purpose | Required high-level backend behavior | Current status |
|---|---|---|---|---|
| `/api/identity-evidence/subjects` | `GET` | list backend-authorized controlled people or animals | resolve the signed-in actor and call the subject/controller facade; return only capability-filtered subjects | subject discovery exists in domain flows; common route pending |
| `/api/identity-evidence?subjectId=...` | `GET` | list masked controller identities and signed-document status for one already-authorized card | reauthorize the signed-in account and exact card, then call `identityEvidence.list(...)` | implemented in a reference provider BFF; extension scope |
| `/api/identity-evidence` action `prepare-declaration` | `POST` JSON | create one separate controller `Person` and download its declaration PDF | call `identityEvidence.prepareDeclaration(...)`; store flat claims provider-side | implemented in a reference provider BFF; extension scope |
| `/api/identity-evidence` action `upload` | `POST` multipart | upload one signed PDF for the chosen controller identity | call `identityEvidence.upload(...)`; private custody and pending status | implemented in a reference provider BFF; extension scope |
| `/api/identity-evidence` action `verify-signature-pdf` | `POST` JSON | request the configured trusted signature verifier | call `identityEvidence.verifySignaturePdf(...)`; only verifier readback changes status | implemented facade and fail-closed adapter; deployed verifier configuration is product-owned |
| `/api/identity-evidence/provider-proxy` | `GET`, `POST` | use the provider flow inside a downstream portal without another login | fixed-origin bearer-forwarding proxy; the provider independently reauthorizes and persists | implemented in a downstream portal; extension scope |
| `/api/identity-evidence/subjects/{subjectId}` | `GET`, `PATCH` | read or edit the selected person/animal | delegate to the existing subject/card facade; domain extension owns the different person and animal fields | domain extension |
| `/api/identity-evidence/controllers/me/identifiers` | `GET`, `POST` | list several controller identities or start adding one | call the individual actor facade; use shared identifier coding and jurisdiction types | list/create facade pending |
| `/api/identity-evidence/evidence/{evidenceId}/attestations` | `POST` | record professional verification or attestation | call `attestIdentityEvidence(...)` only from an authorized professional facade | policy/facade pending |

The reusable browser SDK now exposes `list`, `prepareDeclaration`, `upload` and
`verifySignaturePdf`. BFF routes call the provider identity service and its
trusted verifier port; they do not replace a missing adapter with raw GW/ICA
plumbing. Organization-worker intake and regulated professional attestation
remain pending contracts and must not be presented as implemented.

Actor selection is capability-driven:

- self/controller submission uses `asPersonal()` or
  `asIndividualController()` according to the loaded profile;
- an authorized clinic or municipal worker uses `asOrganizationEmployee()`;
- an attesting regulated professional uses `asProfessional()` and the signed
  occupation credential (for example ISCO-08 veterinarian `2250`);
- programmer-friendly aliases such as `asVeterinarian()` may be added later,
  but they must narrow an already verified professional capability and never
  accept a role selected by the browser.

Country trust is a server-side ICA extension point. Spain reuses the existing
FNMT/PAdES verification adapter. A new country's certificate-chain,
revocation, signing-time and subject-attribute adapter belongs in
`dataspace-ica-ts` behind shared contracts; it does not belong in a browser or
in a domain catalog package.

Minimal BFF adapter shape (illustrative; no transport plumbing):

```ts
// Browser/BFF application contract only. The active-session fetch adapter is
// injected once; the component supplies business fields only.
await identityEvidence.upload({
  subjectId,
  controllerIdentifierId,
  pdf,
});

// Upload remains pending. Render only subsequent provider readback.
const view = await identityEvidence.list({ subjectId });
```

## Secondary Research Use and Digital Twin Provider Lifecycle

The Next.js BFF owns the application routes below and calls the typed Node actor
facade. Browser code never posts a canonical twin Composition and never
selects a twin UUID.

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/secondary-use-consent` | `GET` | show whether research synchronization is enabled for this portal/software/study | calls `getDigitalTwinSecondaryUseConsentStatus(...)` with the BFF-configured `researchUseReference` |
| `/subject/secondary-use-consent` | `PUT` | enable or disable future synchronization | maps `enabled` to canonical `Consent.decision = permit \| deny` through `setDigitalTwinSecondaryUseConsent(...)`; deny preserves the private alias and published anonymous twin |
| `/subject/digital-twin-provider` | `DELETE` | delete the index account or migrate away from this index provider | calls `purgeDigitalTwinSubjectLink(...)`; deletes only the private subject↔twin correspondence and never the anonymous twin |

After `deny` then `permit`, GW reuses the same registered UUID and rebuilds it
from current operational data. After provider purge and later enrollment, GW
allocates a new UUID; the detached anonymous twin remains frozen.

The BFF configures one stable `researchUseReference` URL or URI for its portal,
software or study and reuses it for GET/PUT. GW maps it to
`Consent.source-reference`, resolves or creates the private
`Consent.identifier`, and performs an idempotent upsert. The BFF never stores
that internal identifier. Future studies use different source references even
when they share the same subject, index provider, `HRESCH` and Digital Twin
reader action.

## Host and Test Network facades

These paths exist because they require a distinct operational authority, not
because a named product currently provides the UI.

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/host/observability/errors` | `GET` | read minimized gateway failures for a configured time window | requires an enrolled host-controller profile and returns no clinical payload, token or personal identifier |
| `/host/organizations` | `GET` | list hosted tenants visible to the operator | calls the host-scoped tenant reader or its authoritative materialized projection |
| `/host/organizations/{tenantId}/lifecycle` | `POST` | apply an explicit host-authorized tenant lifecycle transition | invokes the host facade and never reuses a tenant controller profile |
| `/test-network/applications` | `POST`, `GET` | submit or list Test Network admission cases | stores immutable evidence and exposes only the applicant/reviewer-authorized projection |
| `/test-network/applications/{applicationId}/review` | `POST` | authorize or reject one admission | requires the independent Test Network reviewer profile and signed governance evidence |
| `/test-network/applications/{applicationId}/complete` | `POST` | complete tenant transaction, Order, exchange and controller DCR | preserves applicant, reviewer, controller and device proofs as separate steps |

Do not expose these through operator-branded paths.
Branding belongs in configuration and presentation; authorization belongs in
the enrolled host-controller or Test Network reviewer profile.

## Related Persons

This block models subject contacts and relationships, not invited access
members.

Typical examples:

- caregiver
- guardian
- parent
- friend
- emergency contact

One `RelatedPerson`:

- may exist without any member license
- may exist without any access permission
- may also coincide with an invited/authorized actor, but that belongs to a
  different domain block

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/related-persons` | `POST` | create or update guardians, caregivers, or emergency contacts | sends a typed RelatedPerson Bundle attached to `Communication`; direct `RelatedPerson/_batch` is compatibility plumbing |
| `/subject/related-persons` | `GET` | list related persons | refreshes the aggregate through the actor-scoped `RelatedPerson/_search` read and returns the portal-safe view |
| `/subject/related-persons/{relatedPersonId}` | `GET` | get one related-person detail | returns the known detail |

## Subject Members

This block represents actors invited into the individual health-index space.

It is not the same thing as:

- employees of a legal organization
- `RelatedPerson` contacts
- effective `Consent` permissions

One `member` in the individual/family context is an actor invited into the
subject space. After that, the actor may still require specific access
permissions depending on consent or policy.

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/members` | `POST` | invite or register one actor as a member of the individual/family context | the portal backend must orchestrate this over current GW capabilities; there is no equally converged public route today like `employees` or `related-persons` |
| `/subject/members` | `GET` | list actors invited into the subject index | returns a portal-materialized view separate from `related-persons` |
| `/subject/members/{memberId}` | `GET` | get one invited-member detail | returns identity, state, relationship with the subject, and portal-known operational metadata |

## Subject Member Licenses

`Member licenses` in the individual/family context exist to invite actors into
the individual's health index.

They are not for:

- employees of other legal organizations
- `RelatedPerson` contacts just because they are contacts
- external actors without onboarding/invitation into the individual context

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/member-licenses` | `GET` | list available seats/licenses for inviting members into the individual index | may be exposed as a specialized view over `device-licenses` or a portal materialized model for the individual context |

## Communications

`Communication` is the public GW transport boundary for subject-index work,
but it should not become the product/domain API exposed to frontend developers.
The frontend calls meaningful BFF routes such as `/subject/ips`; the BFF uses
actor facades, and those facades author and submit the Communication.

Use it as a backend concept when you need:

- history reconstruction
- traceability
- to inspect what was requested or sent
- debugging of result flows

| Portal API | Method | Frontend purpose | Portal backend behavior |
|---|---|---|---|
| `/subject/communications` | `GET` | list subject communication history/channel | searches or reconstructs `Communication` records |
| `/subject/communications/{communicationId}` | `GET` | get one communication detail | returns the audited envelope and its attachments/references |

## Design Summary

- For frontend-first product design, prioritize:
  - onboarding
  - current offer/license preview before order
  - subject orders
  - licenses only when there is a real admin or guard screen
  - IPS and sections
  - documents
  - consents
  - related persons
  - members when the product exposes delegated access or invitations
- Keep these as backend/internal concerns:
  - GW submit/poll
  - `_exchange`
  - `_dcr`
  - SMART token
  - part of the `Communication` transport complexity
  - direct `Subject/$summary`, `Subject/_search`, `Bundle/_search` and
    `Composition` route construction
- Treat these as product-facing backend facades even if a confidential or
  frontend runtime could call GW directly:
  - legal organization `verification-transaction`
  - organization DID `binding`
- Use `Communication` as channel/history when that UX is explicitly needed, not
  as the only mental entry point for the domain

## Notes On Offers And Licenses

### Employee and license search readback

Employee and license searches return a 0..n Bundle result. The surrounding
DIDComm `body` is the FHIR-like/JSON primary document: `body.total` counts its
entries and every match is the `resource` of one `body.data[]` entry. A client
reads the typed SDK projection and does not parse a nested `resource.data`
list; that older shape was an invalid transport regression, not a FHIR
resource contract.

During the rolling migration, a deployment without
`GW_SEARCH_RESPONSE_PROFILE` keeps emitting the deprecated
`legacy-resource-data` shape so old SDKs do not break. Set
`GW_SEARCH_RESPONSE_PROFILE=primary-resource` to emit the canonical shape.
New SDK readers accept both; only the canonical profile is shown below and in
new application examples.

```ts
// Application code consumes the business projection. Bundle/DIDComm polling
// and `body.data[].resource` extraction remain inside the SDK/BFF.
const inventory = await organizationController.listEmployeeLifecycle(routeContext);
for (const employee of inventory) {
  renderEmployee(employee.email, employee.status, employee.license?.activeDevices ?? 0);
}
```

- In legal organizations:
  - the initial offer usually comes from the activation response
  - the backend can extract `offerId` and preview with helpers such as
    `getOfferIdFromResponse(...)` and `getOfferPreviewFromResponse(...)`
  - the order comes after that
  - buying/adding licenses later requires a separate
    `license-offer -> license-order -> payment-confirmation` flow
- In individual/personal organization:
  - the initial offer usually comes from the individual start response
  - or from the PDF/OTP onboarding path that leads into that start step
  - the order comes after that
  - buying/adding licenses later follows the same separated commercial flow
  - it is also useful to distinguish:
    - general individual-context seats/licenses
    - seats/licenses specifically intended to invite subject `members`
- License listing is converged in the current Node actor facades:
  - `OrganizationControllerSdk.listLicenses(...)` uses tenant
    `entity/org.schema/License/_search`
  - `IndividualControllerSdk.listLicenses(...)` uses tenant
    `individual/org.schema/License/_search`
  - `GET /subject/member-licenses` remains a functional specialization of the
    same source for the individual invitation UX
- `License/_add` is not a CORE operation. Test, local, staging and production
  create inventory during onboarding or through Offer -> Order. Portal and BFF
  code must not construct a direct seat-mutation request.
- Always distinguish these two things:
  - `License/_issue`: does not buy or create new licenses; it reserves one
    existing seat from the `device-licenses` pool and returns an activation code
    for `_exchange` + `_dcr`
  - buy/add licenses: a separate business flow after tenant bootstrap,
    conceptually `offer -> order -> payment -> internal creation of new
    device-licenses`
- In current GW implementation:
  - the buy/add logic exists at internal business-logic level
  - but not yet as one stable, converged public endpoint family equivalent to
    the other SDK flows
  - new licenses are effectively created internally by `LicenseManager` jobs as
    `DeviceLicense` documents in `device-licenses`
  - listing/visualizing licenses can also already be reconstructed from that
    data source
- Practical consequence for a portal backend:
  - if you want to test real buy/add flows from the portal web app, that facade
    still needs to be implemented in the portal backend
  - and payment closing must be wired to the step that triggers effective
    creation of new `device-licenses` in GW
