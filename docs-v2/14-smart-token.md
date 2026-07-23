# 14 SMART Token

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- request subject-scoped access after the right identity and authorization steps exist,
- keep token issuance separate from index-data transport.

## Canonical Endpoint

- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token`
- poll:
  `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response`

## Canonical Rules

- token requests are not the envelope for index data exchange.
- they depend on previously established identity, permissions, and consented access.
- first teach subject-scoped composition/document access before broader management scopes.

## Individual Self-Read And Cross-Portal DIDs

Individual self-read is not inter-tenant research access and does not require a
FHIR `Contract`. It remains subject to a verified individual VP and the
subject-scoped FHIR `Consent` rules stored by the provider.

When the authenticated individual DID differs from the DID used by the
provider index, GW accepts the pair only when all of these conditions hold:

1. The enclosing VP/VC proof has passed the normal clearing-house verification.
2. The VP contains a `SubjectIdentityBindingCredential`.
3. The credential contains both exact individual DIDs.
4. Its issuer appears in `SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS`.
5. Its sector matches the routed sector and its validity window is active.
6. The verified ACR is an individual ACR.

A physical card or other support DID is not an authorization alias. Resolve the
support DID Document and use its `subject` DID. Unverified `alsoKnownAs` values
do not prove identity equivalence.

Professional, family and research actors are intentionally different:

- professional/family access continues through actor, role and Consent rules;
- `organization/ResearchSubject.*` and digital-twin access continues through
  the inter-tenant research-contract boundary;
- neither flow is converted into individual self-read by a DID alias.

## Payload Source Of Truth

- GW shared fixture:
  [SMART_TOKEN_REQUEST in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- shared SDK flow guidance:
  [gdc-sdk-node-ts/docs/101-SDK_END_TO_END.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-SDK_END_TO_END.md)

## Related Tests

- `gwtemplate-node-ts/src/__tests__/integration/identity/smart-token.test.ts`
- `gwtemplate-node-ts/src/__tests__/managers/OpenIdAuthManager.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/utils/swagger-spec.test.ts`

## Out Of Scope

- using token issuance as a substitute for consent/index-data exchange docs
