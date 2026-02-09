## Gaia-X Clearing House = OIDC4VC Compliance Provider (Plain Language)

This document removes Gaia-X marketing terms and maps the Clearing House flow to standard W3C / OpenID concepts.

### What it is (in standards terms)
A Gaia-X Clearing House is an OIDC4VC/OIDC4VP-compatible **compliance provider**:
- A service submits a **Verifiable Presentation (VP)** that includes self-descriptions.
- The Clearing House validates policy/compliance rules.
- It issues a **Verifiable Credential (VC)** that attests compliance.

It does **not** provide strong identity proof, KYC, or operational authorization.

### Term mapping (Gaia-X -> Standards)
| Gaia-X term | Standard term | Notes |
| --- | --- | --- |
| Clearing House | OIDC4VP Verifier + OIDC4VCI Issuer | Verifies VP and issues compliance VC |
| Compliance Credential | Verifiable Credential (VC) | Issued by Clearing House, not a login token |
| Self-Description | Verifiable Credential (VC) | Gaia-X specific subject profile |
| Trust Framework rules | Verification policy | Equivalent to verifier policy rules |
| Trusted Anchor | X.509 Trust Anchor / PKI | Used for signature validation (x5c/x5u) |
| Participant | Credential Subject | Typically `gx:LegalParticipant` |
| Service Offering | Credential Subject | Gaia-X service profile |
| Compliance Check | VP verification | Policy evaluation before issuance |
| Verifier | OIDC4VP Verifier | Receives vp_token / presentation_submission |
| Issuer | OIDC4VCI Credential Issuer | Issues VC as compliance evidence |

### Where it fits in this architecture
- **ICA**: strong identity, evidence, onboarding, operational access, Fabric enrollment.
- **Clearing House**: compliance-only VC for discovery/federation; no access control.

### Public metadata endpoints (host + tenants)
To make the flow discoverable without Gaia-X jargon, the service exposes standard OIDC metadata:
- `/.well-known/openid-configuration` (issuer metadata)
- `/.well-known/openid-credential-issuer` (OIDC4VCI metadata)

### Notes
- The metadata describes standard OIDC4VCI/OIDC4VP endpoints. Implementation of the full issuance/verification flow may be added later.
- The issued VC replaces an `id_token` only as **compliance evidence**, not as a login/authorization token.

### Current issuance endpoint (MVP)
- `POST /:tenantId/cds-:jurisdiction/v1/:sector/identity/oidc/credential`
- Requires `Authorization: Bearer <access_token>` (in demo, any Bearer token is accepted).
- Signs with legacy ES when available; add `?pqc=true` or header `X-PQC-Signature: true` to force ML-DSA.

### Relationship with Observability
Clearing House and Observability are related but distinct responsibilities:
- **Clearing House**: compliance verification (VP/VC checks, policy, credential/status/revocation validation).
- **Observability service**: operational/security traces for API and messaging events.

Some deployments integrate both services behind one provider, but the API domains should remain separate.

Routing convention:
- `/{tenantId}/cds-{jurisdiction}/v1/{sector}/{section}/{format}/{resourceType}/{action}`
- For observability: `section=audit`

Recommended Observability API family (target architecture):
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/audit/didcomm/message/_search`
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/audit/didcomm/message/_get`
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/audit/didcomm/message/_export`
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/audit/fhir/communication/_search`

These endpoints are intended for user-visible, non-repudiable traces of message handling events
(`stored`, `delivered_encrypted`, `decrypted_server_side`, `reencrypted`, `deleted`).
