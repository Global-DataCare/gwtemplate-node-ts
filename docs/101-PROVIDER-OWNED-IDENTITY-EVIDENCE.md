# Provider-owned identity evidence 101

This is a portal extension contract. It does not add an identity-evidence
endpoint to GW CORE.

The portal first chooses a person or animal card that the provider says the
account may already manage. The controller can then have several independent
civil identities. Each identity is a schema.org `Person` with flat
`resource.meta.claims`, linked to the card; it is not a FHIR identity claim.

The browser has four operations only:

```ts
await identityEvidence.list({ subjectId })
await identityEvidence.prepareDeclaration(declaration)
await identityEvidence.upload({ subjectId, controllerIdentifierId, pdf })
await identityEvidence.verifySignaturePdf({ evidenceId })
```

The owning provider reauthorizes the card, stores the `Person` and PDF, and
returns masked readback. Uploading is pending evidence. Only the trusted
verifier may return verified or rejected.

SOSChain can embed the same PetChain flow by forwarding the active signed token
to a fixed provider origin. SOSChain stores no civil identity or PDF, and
PetChain independently validates the token and card relationship.

UI code contains no certificate parsing, claim construction, DIDComm, FHIR
conversion, polling, gateway path or ledger receipt.
