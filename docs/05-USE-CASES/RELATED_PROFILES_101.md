# Related Profiles 101

Status: working architecture note for individual-member and professional relationship discovery.

This document explains the minimum stable model required to support:

- `list my related profiles`
- controller-created individual onboarding
- professional invitations over an individual subject
- future migration as a separate lifecycle

## Goal

A human actor identified by a public `did:web` must be able to ask:

- which other individual subjects am I related to?
- what role do I have in each relationship?

The answer must be resolved from the actor's own provider/tenant, without scanning every external subject index.

## Core rule

Relationship discovery must use two projections:

1. subject-owned projection
2. actor-owned projection

Both projections refer to the same business relationship, but they serve different read paths.

## Mental model

- `subject`
  the individual owner of the record/index being operated on
- `related actor`
  a controller, caregiver, professional, or other person related to that subject
- `subject-owned projection`
  the relationship stored in the subject's index for operational truth
- `actor-owned projection`
  the relationship stored in the actor's own index so the actor can later query `my related profiles`

## Why both projections exist

If only the subject index stores the relationship, the actor would need to search across many external subject indexes.

That is not acceptable for the normal portal/backend flow.

Therefore:

- the subject index stores the authoritative relationship
- the actor index stores a searchable inverse projection

## Onboarding rule

Initial individual creation happens in the same service/provider where the controller already has an index.

That means:

1. controller already has a tenant/provider where their own index lives
2. controller creates a new individual subject from that same service
3. the new subject index is created there
4. both relationship projections are created there

Migration to a different provider is a separate future lifecycle. It is not part of initial onboarding.

## Controller-created individual

When a controller creates a new individual subject:

1. a new individual subject index is created
2. in the subject index, create a `RelatedPerson` projection for the controller
3. in the controller's own index, create an inverse `RelatedPerson` projection pointing to the new subject

Recommended semantics:

- subject-owned projection
  - `subject = new individual did:web`
  - related actor = controller did:web or controller actor identity
  - role = `controller` or `legal-representative`
- actor-owned projection
  - `subject = new individual did:web`
  - related actor = same controller actor
  - role = the role the controller has over that subject

## Professional invited by an individual

The same pattern applies to professionals:

1. in the subject index
   - create the professional relationship to the invited professional
2. in the professional's own index
   - create the inverse projection so the professional can query `my related profiles`

Typical role values:

- `professional`
- `caregiver`
- `controller`
- `legal-representative`
- `self`

## Optional `self` profile

Some products want the actor's own primary profile to appear in the same selector as related profiles.

That can be modeled as a special `self` projection:

- `subject = actor's own subject did`
- actor role = `self` or `oneself`

This is optional.

Do not block the main architecture on this. The core requirement is discovery of other related subjects.

## Query path

`list my related profiles` must query the actor-owned index.

It must not query all subject indexes.

Minimal flow:

1. backend knows current actor `did:web`
2. backend resolves actor tenant/provider context
3. backend calls GW `RelatedPerson/_search`
4. GW looks in the actor-owned relationship projections
5. GW returns the list of subjects plus the actor role on each one

## Search/index contract

Current shared contract is based on:

- canonical flat claims in `resource.meta.claims`
- shared `SearchParameterDefinition`
- shared `ParameterData`
- blind-query `indexed.attributes`

For `RelatedPerson`, the shared search contract currently lives in:

- `gdc-common-utils-ts/src/models/fhir-related-person.ts`

Current scope:

- aliases inside one resource search contract are supported
- mixed-collection semantic aliases across different resource families are not yet implemented

## Portal backend contract

The portal backend should expose product endpoints such as:

- `GET /api/personal/related-profiles`

It should not expose raw GW routes to the frontend.

The backend should:

1. resolve the current actor identity
2. call GW using the Node SDK
3. map the GW response to a frontend DTO

## Current DTO shape

Use the shared related-profile DTO contract from:

- `gdc-common-utils-ts/src/models/related-profile.ts`
- `gdc-sdk-core-ts/src/related-profiles.ts`

Current response shape:

```json
{
  "actorIdentifier": "did:web:example.com:person:controller-1",
  "total": 2,
  "data": [
    {
      "relationshipId": "urn:uuid:rel-001",
      "source": "relatedperson",
      "subjectId": "did:web:example.com:individual:child-1",
      "actorIdentifier": "did:web:example.com:person:controller-1",
      "relationship": "controller",
      "role": "controller",
      "isController": true,
      "status": "active",
      "claims": {}
    }
  ]
}
```

## Current TODO

- support semantic alias queries across different resource families in mixed collections
- generate `CapabilityStatement.searchParam[]` dynamically from shared search catalogs
- document the exact `self` projection lifecycle when product decides to expose it
