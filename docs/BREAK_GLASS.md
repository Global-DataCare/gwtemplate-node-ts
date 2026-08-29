# GW CORE break-glass authorization

GW CORE exposes an opt-in SMART token extension for exceptional emergency
reads. It is a shared capability: product deployments select whether to enable
it, but cannot weaken its subject, sector, credential, scope or audit gates.

## Authorization boundary

Every request must meet all applicable conditions:

1. It carries a verified and non-revoked professional VP whose evidence was
   confirmed by the ledger-backed clearing path.
2. Human subjects use exactly `health-care` and an ISCO-08 physician occupation
   (`221*`). Animal subjects use exactly `animal-care` and ISCO-08 veterinarian
   occupation `2250`.
3. The emergency FHIR Consent is pinned to one professional, subject, incident
   and read-only scope. Its configured period is at most 24 hours. Each SMART
   token issued under it is valid for no more than 900 seconds.
4. The declared subject kind matches the canonical subject DID. Human
   `:individual:` identifiers and animal `:card:uhc:animal:`/`:animal:`
   identifiers cannot be interchanged.
5. The request supplies an opaque incident id, a coded reason and a meaningful
   justification. GW persists one flat-claims FHIR Consent with purpose
   `ETREAT`; Fabric accepts its hash-minimized anchor and the controller
   notifier acknowledges delivery before the first token is issued.
6. Repeating the same professional, subject, incident and scope reuses the
   active Consent while creating a new token authorization and Fabric event.

`health-research`, `animal-research` and `onehealth-research` always deny
break-glass. Organization membership, employment, police authority, caregiver
status and nursing occupation do not imply this capability. A multi-sector
organization acts through the exact subject-owning care service; authority in
one service never crosses into another.

## Request extension

The existing device-bound SMART request and professional VP remain mandatory.
The optional DIDComm body member is:

```json
{
  "break_glass": {
    "incidentId": "<opaque incident identifier>",
    "subjectKind": "human",
    "reasonCode": "life-threatening",
    "justification": "<10 to 500 characters retained only in the private emergency request>"
  }
}
```

Human reason codes are `life-threatening`, `serious-imminent-harm` and
`unconscious-or-incapacitated`. Animal access uses `animal-emergency`.

## Audit, notification and configuration

Fabric receives only stable hashes and coded facts plus the public requesting
organization DID and jurisdiction: incident, actor and subject hashes;
professional role; routed sector; subject kind; reason; requested-scope hash;
Consent period; token issue/expiry; and notification acknowledgement hash. The
free-text justification and professional email/DID never enter the ledger.

The controller notification is a FHIR `Communication` addressed through the
subject's secure mailbox resolver. It contains the requesting organization,
jurisdiction, professional hash, Consent id and Fabric asset locator. It never
contains the professional email or the free-text justification; it carries only the coded reason
plus correlation metadata. A mailbox service may queue the notice by subject
until the exact controller profile is linked. The first request creates three correlated
Fabric records: Consent, notification acknowledgement and token authorization;
each renewal creates another token-authorization record under the same Consent.

The feature is disabled unless all production settings exist:

```dotenv
BREAK_GLASS_ENABLED=true
BREAK_GLASS_NOTIFICATION_URL=https://<controller-notification-service>/v1/break-glass
BREAK_GLASS_NOTIFICATION_TOKEN=<secret reference>
BREAK_GLASS_CONSENT_TTL_SECONDS=86400
```

`registerArtifactBundle` owns the `artifact-sc` contract selection; callers
cannot redirect artifact writes with a break-glass or FHIR environment value.

The notification token must be injected from the deployment secret store. The
feature uses the process-owned runtime KEK created during normal GW bootstrap;
it performs no per-request KMS unwrap and introduces no global plaintext key.
