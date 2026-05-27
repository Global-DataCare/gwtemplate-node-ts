# Tenant Lifecycle Suspension / Reactivation

## Purpose

This file is the handoff context for a separate work thread focused on adding tenant lifecycle controls to the GW host/operator flow:

- activate
- suspend
- reactivate
- revoke / decommission

The immediate product goal is:

- create a tenant
- suspend it
- activate it again

using test/demo credentials first, and later replacing that trust material with ICA-backed credentials derived from real signed evidence (for example a PDF signed by the legal representative of the node operator organization).

## Current repo context

### What this repo is

`gwtemplate-node-ts` is the GW host/operator backend. It exposes:

- hosted organization registration / ordering
- employee onboarding
- family / individual onboarding
- FHIR and didcomm-facing flows
- activation / discovery / token-related flows

For the current demo deployment, the GW is already reachable publicly by IP and is running in:

- GKE
- `NODE_ENV=demo`
- `QUEUE_PROVIDER=mem`
- `DB_PROVIDER=mem`
- `STORAGE_PROVIDER=mem`

The current public demo endpoint is externalized as a plain HTTP IP-based service for now.

### What is not in scope yet

- full Fabric / blockchain network lifecycle
- internal co-deployment with `dataspace-ica-ts`
- production-grade DNS / TLS / domain-based ingress

`dataspace-ica-ts` should be treated as a separate external service operated by another organization. Any future integration with ICA must therefore happen over public/external URLs, not internal Kubernetes service discovery.

### Why this matters

Today the GW can onboard and bootstrap tenants, but it does not yet have a clean lifecycle model for:

- suspending a tenant/operator authorization
- reactivating it
- revoking it permanently

The desired business behavior is that the tenant/operator authorization should behave like a W3C VC lifecycle:

- `active` or valid
- `suspended` for temporary disablement
- `revoked` for irreversible disablement

This should drive whether the tenant is allowed to operate.

## Standards / trust model direction

The correct standards direction is not “invent a local suspended flag and call it done”.

The target model is:

- the operator / tenant authorization is represented by a credential-like authorization artifact
- that artifact has a verifiable status model
- the status can become:
  - valid
  - suspended
  - revoked

Relevant standards direction:

- W3C VC 2.0 uses `credentialStatus` to discover current credential state, including suspension and revocation
- European VC / EBSI-style status models also distinguish valid, suspended, revoked

For the first implementation pass in this repo, it is acceptable to emulate the trust/status lifecycle locally with test/demo credentials, as long as the model is explicitly designed so that a later ICA-backed implementation can replace the local trust stub.

## Product / business rules already discussed

### Suspension vs revocation

- `suspended` must be reversible
- `revoked` must be final for practical purposes

### Operational expectations

When a tenant is suspended, the GW should block meaningful tenant activity, at least:

- new onboarding under that tenant
- employee create / activate
- family / individual onboarding
- token issuance or auth flows that require active operator authorization
- other hosted business operations that depend on tenant validity

When a tenant is reactivated, those flows should work again.

When a tenant is revoked, future reactivation should not be allowed through the same reversible path.

### Related organizational lifecycle rule already discussed

Separately from VC status, the organization/controller should not be freely deactivated while dependent active actors still exist. The working rule discussed was:

- do not allow organization/controller deactivation while active employees remain
- do not allow it while active individual organizations / clients / patients remain

That rule is adjacent to this work and should be considered when defining endpoint semantics, but the first priority is tenant authorization lifecycle itself.

## Architecture recommendation for this repo

Do not start by wiring directly to ICA network calls.

First implement the local lifecycle contract and enforcement in the GW:

1. explicit tenant authorization lifecycle state
2. route / manager enforcement
3. tests
4. docs / Swagger
5. only then swap or augment status issuance/verification with ICA-backed trust material

That avoids coupling the core behavior to an unfinished external trust dependency.

## Suggested internal model

Introduce an explicit tenant authorization lifecycle concept such as:

- `active`
- `suspended`
- `revoked`

This may be stored:

- in tenant configuration / cache source
- in the confidential tenant record
- or in a dedicated authorization document linked to the tenant

Preferred direction:

- keep the lifecycle tied to an authorization artifact rather than a random local boolean
- even if the first implementation uses a local document, name it in a way that maps naturally to future VC-backed authorization status

## Endpoint direction

The next thread should evaluate and likely implement some subset of these:

- `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`
- `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_suspend`
- `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_reactivate`
- `POST /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_revoke`

If `_revoke` feels too final or too overloaded, `/_decommission` is an acceptable naming alternative, but the semantics must be explicit.

### Semantic guidance

- `_activate`: create or validate the operator authorization and mark it active
- `_suspend`: mark authorization suspended, reversible
- `_reactivate`: allowed only from suspended
- `_revoke`: permanent disablement

### Enforcement guidance

For any tenant-scoped operational route, the thread should identify where lifecycle enforcement belongs:

- API middleware
- manager entry points
- or both

Prefer central enforcement where possible so the rule does not fragment across resource managers.

## Testing expectations

This repo already follows TDD expectations for manager/route behavior changes.

The next thread should add:

1. manager/unit tests for lifecycle transitions
2. route/integration tests for new endpoints
3. route/integration tests proving blocked behavior when suspended or revoked

At minimum, prove:

- active tenant can onboard
- suspended tenant cannot onboard
- reactivated tenant can onboard again
- revoked tenant cannot onboard again

## Documentation expectations

The next thread should update:

- Swagger / OpenAPI route descriptions and examples
- docs that describe tenant activation and hosted operator lifecycle
- `CHANGELOG.md`

Any docs must describe actual current behavior, not aspirational future ICA behavior.

## Non-goals for the next thread

Do not attempt all of this at once:

- real ICA issuance over network
- real signed PDF legal representative flow
- final production revocation infrastructure
- blockchain/Fabric lifecycle coupling

Those should remain future integration steps after the GW lifecycle contract is stable locally.

## Concrete tasks

1. Inspect current activation flow and locate where hosted tenant/operator authorization is persisted.
2. Decide the minimal internal lifecycle representation for `active`, `suspended`, `revoked`.
3. Add unit tests for lifecycle transitions before implementation.
4. Implement `/_suspend` and `/_reactivate` first.
5. Add central enforcement so suspended tenants cannot run hosted onboarding flows.
6. Add integration tests proving:
   - bootstrap/activation works
   - suspension blocks tenant flows
   - reactivation restores them
7. Evaluate whether `/_revoke` should be added now or deferred behind a TODO with tests.
8. Update Swagger/docs/CHANGELOG after test-proven behavior is in place.

## Useful assumptions for the next thread

- demo/test credentials are acceptable for the first cut
- future ICA integration should replace or back the same lifecycle semantics
- external ICA interaction, if introduced later, must use external URLs only
- the public demo deploy is currently IP-only HTTP, so any examples must not assume DNS/TLS yet

## Short prompt for the next thread

Use this exact prompt in the next thread:

`Implement tenant lifecycle suspension/reactivation in gwtemplate-node-ts. Read TODO_TENANT_LIFECYCLE_SUSPENSION.md first, follow its task order, and keep the first cut local/test-driven without depending on real ICA integration yet.`
