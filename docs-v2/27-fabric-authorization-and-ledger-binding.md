# 27 Fabric Authorization And Ledger Binding

This document is the audit source of truth for the MVP separation between the
legal host evidence, governance decisions, GW authorization and Fabric ledger
identity.

## The host PDF is intentionally small

The signed host-service PDF identifies the host service, its responsible legal
provider and its controller. It does not contain:

- Fabric channel names;
- read/write permissions;
- block-zero fingerprints;
- chaincode allowlists.

Those values are technical or mutable governance state and do not belong in
the legal form template.

## Root governance configures channels later

After the host exists, an authorized Root CA controller submits a signed
governance operation that adds or changes the host MSP's membership and
read/write role in the selected channels. The operation is authenticated with
the controller identity and signature and is audited independently from the
host PDF.

GW must not accept a request-supplied channel as authority. It first verifies
the ICA-issued organization VC and current host grant, then resolves the
authenticated tenant, active employment/membership, licence, internal role,
key binding, action, sector and jurisdiction. This prevents a professional in
an unapproved organization, or an approved organization with an unauthorized
actor, from writing.

The organization is the external permission boundary. The individual's role
is the internal action boundary. A veterinarian, doctor, researcher,
responder, insurer employee or crew member receives no channel permission from
the job title alone. Read and write are independent grants.

## Root controller identity is anchored in `identity-global`

`identity-global` is exclusively the global human/governance identity plane.
It is not regional and must not contain animal identities, animal ownership,
clinical records or professional employment records. The bootstrap order is:

1. register the legal organization designated by the rulebook to execute the
   committee's decisions;
2. register the Root CA controller employee/person as a member of that
   organization;
3. persist the controller subject's canonical operation-signing commitment;
4. derive optional operational key and subject-key indexes.

The global human plane contains natural persons, human individual
organizations, their controllers/members and their personal user/device keys.
Professional provider and employee records belong to the channel family that
governs their accredited organization and reference the global person UUID.
A veterinarian is multi-species, not multi-sector: register the professional
once under the veterinary organization in `identity-<region>`, then grant that
organization only the species channel families established by its VC and host
policy. This jurisdictional identity registry owns employment, licence and
professional device/key lifecycle; it grants no species-channel write by
itself.

Sector-region channels use a region suffix:

- `health-care-<region>`: human clinical certification and permissions in
  the selected provider index for that region;
- `animal-pet-<region>`: animal/animal-individual-organization identity,
  one or more ownership relationships, animal clinical certification and
  permissions in the selected provider index for that region.

Institutional channel families are separately governed:

- `research-health-<region>` and `research-animal-<region>` register research
  institutions, researchers and research-governance evidence. One Health read
  grants in the two networks are independent and confer no clinical writes;
- `health-it-<region>` and `animal-it-<region>` register software/device
  organizations and their product or service attestations without provider
  status;
- `health-gov-<region>` and `animal-gov-<region>` register public institutions
  and responders where they are not governed as an integrated regulated
  healthcare provider;
- `health-travel-global` and `animal-travel-global` register global carriers
  and crew credentials, while emergency reads remain explicit GW
  consent/break-glass operations;
- insurance receives a dedicated regional channel only when separate peer
  visibility or endorsement requires it; otherwise it remains an exact GW
  policy grant.

These names are target routing vocabulary, not mandatory MVP provisioning.
Create a channel only for a distinct membership, confidentiality, residency or
endorsement boundary.

The initial region catalog is `eu`, `na`, `asia`, `africa`, `pacific`
and `latam`. Here `asia` includes the Middle East and India;
`pacific` includes China, Japan, Korea, Australia and the rest of the Pacific;
and `latam` includes Latin America and the Caribbean.

The Root CA controller's authoritative operation-signing key binding belongs to
the controller employee/person identity itself:

```text
credentialSubject.hasCredential.material = urn:jwk:<RFC-7638-thumbprint>
```

The RFC 7638 thumbprint is encoded using RFC 9278. This claim binds the stable
employee/person UUID to the public JWK. It is also the canonical model for a
controller or member of an individual organization.

Do not make `subjectkeybinding-sc` a second authority for this relationship.
The GW currently writes that contract during organization DID-key registration
and employee device-key registration or revocation. Its current resolver sends
those writes to one identity channel without applying the required
human-versus-sector-region ownership rule. That routing is a known gap and must
be fixed before treating these records as authoritative.

The GW does not read the contract in an authorization path. The contract
exposes reads and history by
`bindingId`; although it writes composite subject/key indexes, it currently
exposes no reverse-query transaction. Its implemented role is therefore
derived lifecycle/audit state, not authorization enforcement.

`cryptographickey-sc` may store normalized key metadata/status, but both
records are derived and must agree with `hasCredential.material` when they
represent the same canonical operation-signing key.

Fabric chaincode lifecycle does not initialize world state. After the identity
contracts are committed, a protected controller client must derive the key pair
outside Fabric and submit one explicit, idempotent bootstrap transaction. Only
the public thumbprint URN enters the employee identity; the seed and private key
never enter a proposal, block, DID document, JWKS, log or Kubernetes secret.

The current `employee-sc` does not yet persist this claim and exposes no
one-time bootstrap function. This is a production TODO, not an implemented
guarantee. Until it is implemented and tested, the online governance UI must
not claim that ledger anchoring protects its controller key.

The Fabric-CA X.509 admin/client identity used to submit the internal Fabric
transaction is separate from the post-quantum controller JWK used to sign the
public governance request. Audit records must retain both identities without
equating or reusing their private keys.

## MVP chaincode rule

The MVP does not maintain a per-host chaincode allowlist. Once a host is a
member of a channel, GW may address the chaincodes installed and approved on
that channel, subject to:

- GW business authorization and licensing;
- actor and tenant policy;
- Fabric ACL, endorsement and chaincode authorization.

A future governance profile may exclude a capability family, such as genomics
or product traceability, but that is not part of the current GDC MVP contract.

## What block zero does

The SHA-256 fingerprint of block zero only binds a channel name to one concrete
ledger. It grants no membership and no read or write permission.

The Fabric provisioning process already obtains or creates each channel block.
It calculates the fingerprint and injects the internal channel binding into the
GW deployment. Neither a human controller nor the PDF supplies that value.

The operator-facing choice is only:

```text
LEDGER_GENESIS_VERIFICATION=false  # local/unit-test profiles
LEDGER_GENESIS_VERIFICATION=false  # staging/test-network MVP
LEDGER_GENESIS_VERIFICATION=true   # production/network
```

Staging on `test-network` does not require hashes or a chaincode allowlist. With
verification enabled, GW compares the live peer's block zero with the
binding generated by provisioning, persists verified bindings atomically and
enables KMS/business traffic only after every comparison succeeds.

`LEDGER_CHANNEL_GENESIS_SHA256` remains an internal generated transport between
Fabric provisioning and the current GW runtime. It is not a user-maintained
setting, governance decision, PDF claim or public contract.

## What tests prove

Simulated channel tests prove that GW rejects unbound channels and applies
tenant/license/role authorization. They cannot prove that a Kubernetes pod is
connected to the intended live ledger. Block-zero verification supplies that
deployment evidence.

Audit evidence should retain the controller-signed channel configuration
decision, resolved tenant/action decision, expected and observed fingerprints,
peer/MSP identity and binding result. Do not log private keys, bearer tokens,
PDF contents or ledger plaintext merely to demonstrate these controls.
