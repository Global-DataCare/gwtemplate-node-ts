# Clinical employee ledger schema

This document fixes the identifiers and graph used to audit which professional
assignment authored or explicitly attested a clinical resource. It describes
ledger evidence, not the authorization source: GW still verifies the current
tenant, employment, licence, role, key binding and consent before writing.

## Stable opaque identifiers

An employee or professional-assignment UUID is canonicalized as its 32
hexadecimal digits without hyphens and decoded to the UUID's 16 bytes. The
ledger identifier is the multibase58btc representation of the SHA3-384
multihash of those bytes:

```text
assignmentLink = multibase58btc(multihash(sha3-384, practitionerRoleUuidBytes))
employeeLink   = multibase58btc(multihash(sha3-384, employeeUuidBytes))
```

This is a multihash, not merely a base58 encoding of the UUID. A bare UUID,
`urn:uuid:<uuid>`, `PractitionerRole/<uuid>` and a role-bearing employee URN
ending in `:instance:<uuid>` resolve to the same link for that UUID. The two
UUIDs are distinct: an employee/person can hold several professional
assignments. When an external
reference has no UUID, GW hashes its canonical UTF-8 representation; it never
sends the raw DID, URN, URL, email or telephone to the clinical ledger.

For the professional case this produces the exact join:

```text
Composition.author CDS organization URN -> organizationLink
Composition.attester PractitionerRole UUID -> assignmentLink
protected employee UUID -> employeeLink
```

`organizationLink` hashes the complete canonical
`urn:cds-<jurisdiction>:<version>:organization:<type>:<value>` UTF-8 value. It
must not be derived from the operational `did:web`, portal domain, employee
URN or role-license identifier.

## Separated records

The audit graph is deliberately normalized instead of embedding all history in
the clinical artifact:

```text
artifact-sc
  resource CID
    relationships.attester[]  -> professional assignmentLink
    relationships.author[]    -> responsible person or organization opaque link
    relationships.sender[]    -> transport actor opaque link
    relationships.submitter[] -> authenticated submitter opaque link
    relationships.signingKey[]-> key opaque link
    ownerships[]               -> subject opaque link

employee-sc
  assignmentLink -> employeeLink, organizationLink, role, status,
                    validFrom, validUntil and Fabric history
  legacy employeeId -> orgId, role, status, createdAt, updatedAt, revokedAt

subjectkeybinding-sc
  subjectId + keyId -> licensedRole, roleLicenseId, relationship, status,
                       assignmentLink, employeeLink, organizationLink,
                       device audit attributes and ledger history

cryptographickey-sc
  keyId -> orgId, kid/thumbprint, algorithm, use, purpose, status,
           expiry/revocation and ledger history
```

`employee-sc` sets `validFrom` from the Fabric transaction time that first
anchors the assignment and sets `validUntil` when that assignment becomes
revoked. The contract does not accept caller-supplied back-dated periods. Its
Fabric key history preserves every lifecycle update. The legacy employee asset
remains readable for compatibility but is not the join target of new clinical
evidence.

The licence and device keys are associated, not copied into the assignment
asset. `subjectkeybinding-sc` repeats the three opaque links so its `keyId` can
be joined to the exact assignment and legal organization; `roleLicenseId`
records the applicable licence identity. `keyId` resolves in
`cryptographickey-sc`, where the public `kid` or RFC 7638 thumbprint and key
lifecycle live. Private key material never enters any contract. A valid key
binding alone grants no clinical permission.

## Professional provenance

For institutional clinical content, the usual graph is:

- `Composition.author`: the responsible legal organization or institutional
  EHR author, hashed as `organizationLink`;
- `Composition.attester.party`: each professional `PractitionerRole` that
  explicitly attested that version, hashed as `assignmentLink`;
- `Communication.sender`: the business sender;
- authenticated submitter and signing `kid`: transport/audit evidence.

A secretary or assistant who only transports an existing document is sender
and submitter, not automatically an author or attester. The artifact stores a
separate opaque link for every CSV/repeated author and attester value. The
transaction history therefore retains who was linked to each immutable CID,
while `employee-sc` joins `assignmentLink -> employeeLink` and
`subjectkeybinding-sc` joins those same links to `keyId`. Their Fabric histories
determine whether that assignment and key were active at the transaction time.

Personal records follow the same separation but do not invent a professional
assignment: author is the actual individual or member source, attester exists
only after an explicit act, and sender remains transport evidence.
