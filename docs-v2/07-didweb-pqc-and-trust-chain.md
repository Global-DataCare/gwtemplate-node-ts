# 07 did:web, PQC, and Trust Chain

## did:web role

`did:web` is used as practical decentralized identifier binding for service actors and tenants:
- resolvable in web-native environments,
- compatible with document/service discovery,
- operationally simple for managed deployments.

## Trust-chain objective

The trust chain must allow verification of:
- who issued/signed,
- which tenant/actor context is asserted,
- whether presented credentials/assertions satisfy policy.

## Why discuss PQC now

Post-quantum readiness is treated as architecture posture, not immediate full replacement.
Goals:
- avoid lock-in to one classical crypto path,
- keep migration space for hybrid signatures/encapsulation,
- preserve compatibility while introducing stronger future-ready options.

## Practical rule for contributors

- Do not weaken current crypto/identity checks for convenience.
- Additive migration paths are acceptable; silent downgrades are not.
- If introducing compatibility behavior, document risk and expiry plan.
