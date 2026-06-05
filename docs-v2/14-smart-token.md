# 14 SMART Token

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

## Payload Source Of Truth

- GW shared fixture:
  [SMART_TOKEN_REQUEST in example-payloads.ts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/src/__tests__/data/example-payloads.ts)
- shared SDK flow guidance:
  [gdc-sdk-node-ts/docs/101-SDK_END_TO_END.md](https://github.com/Global-DataCare/gdc-sdk-node-ts/blob/main/docs/101-SDK_END_TO_END.md)

## Related Tests

- `gwtemplate-node-ts/src/__tests__/integration/identity/smart-token.test.ts`
- `gwtemplate-node-ts/src/__tests__/unit/utils/swagger-spec.test.ts`

## Out Of Scope

- using token issuance as a substitute for consent/index-data exchange docs
