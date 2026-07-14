# Deactivation And Purge Lifecycle

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Status: Canonical operational contract for auditors and integrators.

This document explains the lifecycle at the three hosted levels currently modeled by GW CORE:

- individual
- tenant
- host

The goal is to make two things explicit:

1. what `disable` means operationally
2. what `purge` deletes physically

It also clarifies the guard rails between levels:

- an individual must be disabled before purge
- a tenant must stop having active descendants before it can be disabled
- a tenant must have no unpurged descendants before it can be purged
- a host must have no hosted tenants remaining before it can be disabled or purged

## Terms

- `disable`: reversible operational deactivation
- `purge`: irreversible destructive deletion
- `active`: still operational/published
- `suspended`: disabled, no longer operational/published
- `revoked`: purged/irreversible lifecycle end-state

`disable` is the control-plane step.  
`purge` is the data-plane deletion step.

They are intentionally separated.

## Storage Model

The storage boundary matters for auditors:

- Firestore/PostgreSQL store metadata, lifecycle state, searchable claims, and blob references.
- Confidential encrypted payloads (`JWE`) are externalized to blob storage.
- Blobs can be backed by GCS, Supabase storage, or another blob adapter.

So, when this document says "purge data", that includes:

- deleting indexed/container records from the primary repository
- deleting referenced confidential blobs

It is not enough to delete only the index row/document.

## 1. Individual Lifecycle

Scope:

- the hosted individual/family registration record
- subject-scoped sections derived from that individual
- confidential blobs referenced by those records

### Disable Individual

`disable individual` means:

- the hosted individual organization is marked non-operational
- the individual can no longer be treated as an active hosted subject
- audit/history is preserved
- data is not deleted yet

This step is required before purge.

### Purge Individual

`purge individual` is destructive.

However, communication retention is a separate policy boundary. By default,
clinical/professional communications are not purged together with the hosted
individual record.

It must remove:

- the family/individual registration record itself
- subject-scoped section containers associated with that individual
- blobs referenced by those individual records

It must not remove retained `Communication` records when retention remains
enabled.

Current default policy:

- `COMMUNICATION_RETENTION_DISABLED=false`

Meaning:

- `false` or unset: purge skips retained communications
- `true`: hosting/runtime policy may additionally allow communication purge

Why this default exists:

- health-care communications may need to be retained for complaints,
  malpractice review, safeguarding, or legal threats
- the right to erasure is not absolute where retention is needed for legal
  claims, legal obligations, or health-care delivery

Compliance/audit references:

- ICO storage limitation:
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/
- ICO right to erasure:
  https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/

Current practical meaning of "subject-scoped sections":

- the base `individual` section
- hashed/derived `individual_*` sections that store subject/member scoped content

Current practical meaning of "blob deletion":

- if a confidential record was externalized to blob storage, purge must also delete that blob reference target
- this includes confidential `JWE` payloads and other large protected payloads stored out-of-line

### Why disable first?

Because `disable` and `purge` are not the same control:

- `disable` proves intent to shut down operations first
- `purge` performs irreversible deletion second

That separation is required both for auditability and for safe orchestration of dependent cleanup.

## 2. Tenant Lifecycle

Scope:

- a hosted legal organization/provider tenant
- its publication/discovery state
- its descendants:
  - employees
  - individuals/family registrations
  - individual/member subject-scoped records

### Disable Tenant

`disable tenant` means:

- the tenant stops being an operational provider
- the tenant stops publishing active dataspace services
- the tenant should no longer appear as an available provider in discovery/catalog publication
- tenant operational routes that require active authorization must stop working
- audit/history is preserved

This is the "stop being provider" step.

### Publication Effect Of Tenant Disable

Operationally, a disabled tenant must no longer publish:

- tenant `dspace-version`
- tenant DCAT catalog endpoints
- provider availability through host autodiscovery/catalog aggregation

Its DID/JWKS may still remain resolvable for traceability.

The point is:

- identity resolution may remain
- service publication must stop

### Preconditions For Tenant Disable

The tenant cannot be disabled while active descendants remain.

At minimum:

- active employees block tenant disable
- active individuals/members block tenant disable

This prevents a provider from disappearing while it still has live hosted actors below it.

### Purge Tenant

`purge tenant` is destructive.

As with individual purge, retained communications are a separate policy
boundary and are skipped by default while
`COMMUNICATION_RETENTION_DISABLED=false`.

It is only allowed after the tenant has already been disabled.

It also requires that descendants are no longer merely disabled, but already purged when required by policy.

Current rule:

- employee records not yet purged block tenant purge
- individual/member records not yet purged block tenant purge

This means:

1. disable descendants
2. purge descendants
3. disable tenant
4. purge tenant

That sequence is intentional and conservative.

## 3. Host Lifecycle

Scope:

- the hosting operator itself
- its host discovery/publication surface
- the registry of hosted tenants

### Disable Host

`disable host` means:

- the host stops being discoverable as an active hosting operator
- the host must stop publishing its host discovery/catalog availability
- it must no longer be considered available for onboarding new tenants

Operationally, that means the host should stop advertising:

- host `dspace-version`
- host DCAT catalog endpoints
- host provider-discovery aggregation endpoints

Its DID/JWKS may still remain available for auditability and traceability.

### Preconditions For Host Disable

The host cannot be disabled while hosted tenants still remain registered.

The current ownership model is:

- tenant purge is performed by the tenant controller
- host controller does not purge hosted tenants on their behalf

So the host controller can only disable the host after hosted tenants have already been purged and removed from the host registry.

### Purge Host

`purge host` is destructive and final.

In normal production policy, host purge should still be blocked while retained
communications remain under hosted data responsibility. Test or explicit
cleanup environments may temporarily set
`COMMUNICATION_RETENTION_DISABLED=true` to allow full destructive cleanup.

It is only allowed when no hosted tenant registrations remain.

This is the last step in the hierarchy.

Order:

1. purge individuals
2. purge tenants
3. disable host
4. purge host

## Activation / Reactivation

Reactivation is not just a local toggle.

For organization/host activation, the authorization proof must include:

- `org.schema.Service.category`
- `org.schema.Service.serviceType`

That proof is what authorizes the participant to publish and operate in the dataspace.

### Tenant/Provider Activation

For a hosted tenant, the ICA-issued organization credential must authorize:

- the requested sector/category
- the requested provider service types

GW must not activate a tenant under a category/service profile that is not present in the credential.

### Host Activation

For a host, the authorization must include:

- `org.schema.Service.category = system`
- `org.schema.Service.serviceType = organization/Organization.cruds`

That service type expresses that the host is allowed to host/manage organizations.

## Auditor Checklist

- Verify that `disable` and `purge` are separate operations.
- Verify that purge is blocked until prerequisite disable has happened.
- Verify that individual purge removes both indexed/container data and referenced blobs.
- Verify that tenant disable removes provider publication/discovery visibility.
- Verify that tenant purge is blocked while descendant records remain unpurged.
- Verify that host disable is blocked while hosted tenants remain.
- Verify that host purge is blocked while hosted tenants remain.
- Verify that activation requires authorized `category` and `serviceType`, not just a generic organization VC.

## Integrator Checklist

- Treat `disable` as reversible operational deactivation.
- Treat `purge` as irreversible deletion.
- Do not call tenant purge before descendant cleanup.
- Do not call host disable/purge before hosted tenant cleanup.
- Do not assume DID removal is the same as service unpublication.
- When preparing activation proofs, always include the correct `category` and `serviceType`.

## Practical Summary

## Portal/API Lifecycle Table

This condensed table is intended as a bridge for portal/backend designers who
need a route-level view of the lifecycle contract.

| Scope | Operation | Portal/backend intent | Required preconditions | Expected effect |
|---|---|---|---|---|
| Individual | `disable` | stop treating a hosted subject as active | individual exists and is currently active | operational deactivation only, no physical deletion |
| Individual | `purge` | irreversibly remove a hosted subject footprint | individual already disabled | delete registration, subject-scoped sections, and referenced confidential blobs |
| Tenant | `disable` | stop a provider from operating/publishing | no active descendant employees or individuals/members remain | provider discovery/publication stops; audit identity may remain resolvable |
| Tenant | `purge` | irreversibly remove a hosted legal organization/provider | tenant already disabled and descendants already purged as required by policy | delete tenant registration and remaining tenant-owned data footprint |
| Host | `disable` | stop the hosting operator from being discoverable/onboarding new tenants | no hosted tenants remain registered | host discovery/publication stops; DID/JWKS may remain for traceability |
| Host | `purge` | irreversibly remove the hosting operator footprint | host already disabled and no hosted tenants remain | delete host registration and remaining host-owned data footprint |

- Individual:
  - disable first
  - then purge sections + blobs
- Tenant:
  - disable to stop being provider/published
  - purge only after individuals/employees are gone
- Host:
  - disable to stop being discoverable as hosting operator
  - purge only after tenants are gone

That is the intended lifecycle contract.
