# Clinical employee ledger schema

This document fixes the identifiers and graph used to audit which professional
assignment authored or explicitly attested a clinical resource. It describes
ledger evidence, not the authorization source: GW still verifies the current
tenant, employment, licence, role, key binding and consent before writing.

## Stable opaque identifier

An employee or professional-assignment UUID is canonicalized as its 32
hexadecimal digits without hyphens and decoded to the UUID's 16 bytes. The
ledger identifier is the multibase58btc representation of the SHA3-384
multihash of those bytes:

```text
employeeLink = multibase58btc(multihash(sha3-384, uuidBytes))
```

This is a multihash, not merely a base58 encoding of the UUID. A bare UUID,
`urn:uuid:<uuid>`, `PractitionerRole/<uuid>` and a role-bearing employee URN
ending in `:instance:<uuid>` resolve to the same link. When an external
reference has no UUID, GW hashes its canonical UTF-8 representation; it never
sends the raw DID, URN, URL, email or telephone to the clinical ledger.

## Separated records

The audit graph is deliberately normalized instead of embedding all history in
the clinical artifact:

```text
artifact-sc
  resource CID
    relationships.attester[]  -> employee or PractitionerRole opaque link
    relationships.author[]    -> responsible person or organization opaque link
    relationships.sender[]    -> transport actor opaque link
    relationships.submitter[] -> authenticated submitter opaque link
    relationships.signingKey[]-> key opaque link
    ownerships[]               -> subject opaque link

employee-sc
  employeeId -> orgId, role, status, createdAt, updatedAt, revokedAt

subjectkeybinding-sc
  subjectId + keyId -> licensedRole, roleLicenseId, relationship, status,
                       device audit attributes and ledger history

cryptographickey-sc
  keyId -> orgId, kid/thumbprint, algorithm, use, purpose, status,
           expiry/revocation and ledger history
```

`employee-sc.createdAt` is the currently implemented effective `validFrom` of
the assignment, and `revokedAt` is its effective `validUntil` when revoked.
The contract does not yet expose independent back-dated `validFrom` and
`validUntil` fields. Its Fabric key history preserves every status/DID update.
Documentation and UI must not claim finer employment intervals until those
fields and their validation are implemented.

The licence and the device keys are associated, not copied into the employee
asset. `subjectkeybinding-sc.roleLicenseId` links the role-bearing subject to
the applicable licence identity; `keyId` links to `cryptographickey-sc`, where
the public `kid` or RFC 7638 thumbprint and key lifecycle live. Private key
material never enters any contract. A valid key binding alone grants no
clinical permission.

## Professional provenance

For institutional clinical content, the usual graph is:

- `Composition.author`: the responsible legal organization or institutional
  EHR author;
- `Composition.attester.party`: each professional `PractitionerRole` that
  explicitly attested that version;
- `Communication.sender`: the business sender;
- authenticated submitter and signing `kid`: transport/audit evidence.

A secretary or assistant who only transports an existing document is sender
and submitter, not automatically an author or attester. The artifact stores a
separate opaque link for every CSV/repeated author and attester value. The
transaction history therefore retains who was linked to each immutable CID,
while employee, licence and device-key histories determine whether that
assignment and key were active at the transaction time.

Personal records follow the same separation but do not invent a professional
assignment: author is the actual individual or member source, attester exists
only after an explicit act, and sender remains transport evidence.
