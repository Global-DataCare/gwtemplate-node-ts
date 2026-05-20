# 06 Security Model and Why

## Why this stack exists

The platform is designed for high-assurance health/document exchange where:
- identity and authorization must be auditable,
- payload integrity/confidentiality must be explicit,
- interoperability must survive heterogeneous clients and legacy integrations.

## Why FAPI-like posture

A FAPI-grade posture reduces common API abuse risks:
- token replay,
- weak client binding,
- ambiguous authorization contexts,
- insecure redirect/token exchange patterns.

Operational consequences:
- explicit client registration and token exchange discipline,
- strong bearer handling and short-lived artifacts,
- endpoint contracts that support secure polling for async flows.

## Why keep legacy-compatible paths

Legacy-compatible routes/claims exist to avoid hard cutovers in active deployments.
Rule:
- canonical contracts are preferred,
- compatibility aliases are temporary and must be tracked as TODO,
- no new feature should be designed only around legacy shapes.

## Threat model summary

Primary threats considered:
- impersonation of actors/tenants,
- payload tampering in transit,
- replay of async job artifacts,
- over-broad data access due to weak scope boundaries.

Controls are distributed across:
- request validation,
- scoped routing/contracts,
- cryptographic verification paths,
- auditable async submit/poll model.
