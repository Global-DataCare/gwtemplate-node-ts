# 07 did:web, PQC, and Trust Chain

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

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

## Ledger anchor for a governance controller

The global identity ledger, not the public website, is the authority for the
governance controller's operation-signing key. The controller is represented
as an employee/person identity. Its canonical key binding is the claim:

```text
credentialSubject.hasCredential.material = urn:jwk:<RFC-7638-thumbprint>
```

The RFC 7638 JWK thumbprint is represented using the RFC 9278 URN form. Because
the claim belongs to the employee/person subject, it binds that subject's stable
internal UUID to the public operation-signing key. Controllers and other
members of an individual organization use the same subject-owned claim.

`subjectkeybinding-sc` is not required to establish this root binding. Its
current useful scope is derived operational indexing: device keys, several
active keys, reverse lookup, suspension, rotation and revocation. Likewise, a
`cryptographickey-sc` asset can describe key status and metadata. Neither may
override the employee/person `hasCredential.material` claim, and both must be
consistent with it when they represent the same operation-signing key.

Verification of a public governance request therefore requires both:

1. a valid signature proving possession of the private key corresponding to
   the ledger-anchored thumbprint; and
2. a DID document or JWKS whose presented public JWK produces that same
   thumbprint.

DID/JWKS remains a discovery and presentation surface. Compromising that web
surface cannot silently replace the controller key because the substituted key
will not match the identity ledger.

## Bootstrap is a transaction, not chaincode installation

Installing, approving or committing an identity chaincode does not write the
controller record. The current `employee-sc` also has no `Initialize` or
`InitLedger` transaction and its current `CreateEmployee` payload does not
persist `hasCredential.material`. Production governance bootstrap is therefore
explicitly incomplete until that contract gap is resolved.

The required bootstrap sequence is:

1. Register the legal governance-executor organization in `identity-global`,
   the human/governance identity plane. This organization is a
   deployment/rulebook input, not a hard-coded product organization.
2. In the protected controller runtime, accept or generate the seed and derive
   the post-quantum operation-signing key pair. Never send the seed or private
   key to Fabric, DID/JWKS, logs or Kubernetes configuration.
3. Compute the public JWK's RFC 7638 thumbprint and RFC 9278 URN.
4. After the identity contracts are committed, submit one explicit,
   idempotent bootstrap transaction that creates the Root CA controller
   employee/person under that registered organization and stores the URN in
   `hasCredential.material`.
5. Reject a second root-controller initialization and retain the Fabric
   transaction identity, block history and canonical public bootstrap payload
   as audit evidence.
6. Require later key rotation to be an authorized ledger transaction preserving
   the previous claim/history and proving continuity with the currently active
   controller key.

An explicit `BootstrapGovernanceController` transaction is preferable to a
generic sample `InitLedger`: it states the one-time invariant and can fail
closed. This document specifies the required behavior; it does not claim that
the transaction is already implemented.

## Two separate credential planes

Do not conflate these credentials:

- Fabric-CA issues internal X.509 admin/client certificates. They authenticate
  MSP membership, peer proposals, chaincode lifecycle and channel
  configuration operations.
- The controller's post-quantum JWK is generated under controller custody and
  signs application-level governance requests sent to public data-space
  endpoints. Its public thumbprint is anchored in the identity ledger.

The same person may control both workflows, but the keys, issuers, purposes,
rotation and custody boundaries remain independent. A Fabric admin private key
must never be published in DID/JWKS, and the public-governance seed/private key
must never become a Fabric-CA enrollment key.

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
