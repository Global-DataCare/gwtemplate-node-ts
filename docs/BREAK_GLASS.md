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
3. The SMART scope is read-only (`r` or `rs`), pinned to one subject and valid
   for no more than 900 seconds.
4. The declared subject kind matches the canonical subject DID. Human
   `:individual:` identifiers and animal `:card:uhc:animal:`/`:animal:`
   identifiers cannot be interchanged.
5. The request supplies an opaque incident id, a coded reason and a meaningful
   justification. Fabric accepts the hash-minimized authorization and the
   controller notifier acknowledges delivery before the token is issued.

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
    "justification": "<10 to 500 characters for controller notification>"
  }
}
```

Human reason codes are `life-threatening`, `serious-imminent-harm` and
`unconscious-or-incapacitated`. Animal access uses `animal-emergency`.

## Audit, notification and configuration

Fabric receives only stable hashes and coded facts: incident, actor and subject
hashes; professional role; routed sector; subject kind; reason; requested-scope
hash; issue time; expiry; and notification acknowledgement hash. The free-text
justification never enters the ledger.

The feature is disabled unless all production settings exist:

```dotenv
BREAK_GLASS_ENABLED=true
BREAK_GLASS_NOTIFICATION_URL=https://<controller-notification-service>/v1/break-glass
BREAK_GLASS_NOTIFICATION_TOKEN=<secret reference>
BREAK_GLASS_LEDGER_CHAINCODE=artifact-sc
```

The notification token must be injected from the deployment secret store. The
feature uses the process-owned runtime KEK created during normal GW bootstrap;
it performs no per-request KMS unwrap and introduces no global plaintext key.
