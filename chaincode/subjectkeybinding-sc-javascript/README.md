# subjectkeybinding-sc

This chaincode records an operational relationship between an identity subject
and a cryptographic key. It is an audit/index contract. It is not the canonical
identity record, a channel authorization mechanism, or a replacement for the
credentialSubject.hasCredential.material claim.

## Channel ownership boundary

Deploy the contract in each channel that owns subjects with operational keys;
do not build one cross-sector key registry.

- identity-global owns natural persons, human individual organizations, their
  controllers/members and personal user/device keys.
- health-care-REGION owns professional provider/employee relationships, their
  professional keys, human clinical certification and provider-index
  permissions for that region.
- animal-pet-REGION owns animal/animal-individual-organization identity,
  multiple ownership relationships, veterinary provider/employee professional
  keys, animal clinical certification and provider-index permissions.

REGION is one of eu, na, asia, africa, pacific or latam. A professional employee
record references the person's global UUID without copying the global human
identity into the sector channel.

## Canonical bootstrap order

The governance bootstrap is ordered:

1. Register the legal organization designated by the rulebook to execute the
   data-space committee's decisions in organization-sc on identity-global.
2. Register its initial Root CA controller as an employee/person belonging to
   that organization in employee-sc on identity-global.
3. Store the controller's canonical operation-signing commitment on that
   identity as:

       credentialSubject.hasCredential.material =
         urn:jwk:<RFC-7638-thumbprint>

   The thumbprint uses the RFC 9278 URN representation.
4. Optionally derive cryptographickey-sc and subjectkeybinding-sc records for
   operational audit, key lifecycle and lookup.

Installing or committing chaincode does not perform these writes. The current
employee-sc cannot yet persist hasCredential.material and has no one-time
bootstrap transaction. BootstrapGovernanceController remains a production
TODO. Never substitute this chaincode for that missing canonical write.

## Current GW use cases

The GW currently writes bindings in two flows:

- organization onboarding: each public JWK in the organization's DID document
  is registered in cryptographickey-sc and linked to the organization;
- employee/person device registration and replacement: each device signing or
  encryption JWK is linked to the subject, and the key and binding are marked
  revoked during revocation.

Current limitation: the GW resolver sends these records to one identity channel
and does not yet select identity-global versus the owning sector-region channel.
That routing must be corrected before using a binding as authoritative audit
state.

Typical asset:

    {
      "bindingId": "employee_<employee-uuid>__<key-id>",
      "subjectType": "employee",
      "subjectId": "<employee-uuid>",
      "parentOrgId": "<organization-uuid>",
      "keyId": "<RFC-7638-thumbprint-or-key-id>",
      "relationship": "employee-device-signing",
      "status": "active"
    }

For the canonical controller operation-signing key, any derived binding must
match hasCredential.material. A mismatch is an error; this chaincode must never
override the identity claim.

## What it does today

Transactions:

- CreateSubjectKeyBinding(bindingId, payloadJson)
- UpsertSubjectKeyBinding(bindingId, payloadJson)
- ReadSubjectKeyBinding(bindingId)
- UpdateBindingStatus(bindingId, status, timestamp, reason, metadataJson)
- GetSubjectKeyBindingHistory(bindingId)

Allowed statuses are active, suspended, revoked and expired.

The contract writes subject-binding and key-binding composite index entries,
but it does not currently expose transactions to query those indexes. The GW
also does not currently read this contract in an authorization path. Therefore
the implemented value today is binding-by-ID lifecycle and history; reverse
lookup and enforcement are future work.

## Trust and credential separation

- Fabric-CA/MSP X.509 credentials authenticate internal Fabric submissions.
- The controller's public post-quantum JWK verifies application-level
  governance operations.
- Seeds and private keys never enter this asset, Fabric proposals, blocks,
  DID/JWKS documents, logs or Kubernetes configuration.

The Fabric transaction identity and the public governance signer should both be
retained as audit evidence, while remaining different credential planes.

## Test

    npm test
