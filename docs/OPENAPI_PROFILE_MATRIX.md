# OpenAPI Profile Matrix

Explicit endpoint classification used by profile generation.

## Core

- `/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate`
- `/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response`
- `/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch`
- `/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch-response`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token`
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response`

## Compat

- All `/identity/openid/*` compatibility aliases not listed as core canonical.
- `/auth/token`

## Extension

- `/digitaltwin/*`
- `/{tenantId}/.../individual/org.hl7.fhir.api/Observation/*`
- `/{tenantId}/.../individual/org.hl7.fhir.api/Subject/*`
- Any appointment-specific vertical surfaces (kept out of current core profile).
