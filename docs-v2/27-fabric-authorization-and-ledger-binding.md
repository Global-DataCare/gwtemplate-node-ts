# 27 Fabric Authorization And Ledger Binding

This document is the audit source of truth for the separation between business
authorization, Fabric enforcement and ledger identity.

## Three independent controls

### 1. Host authorization

Governance approves a host for an exact set of capabilities. The signed
decision identifies the host, provider, controller, jurisdiction, sector and
the permitted read/write/admin operations. A human controller approves those
business facts; the controller must not copy block hashes into Kubernetes.

### 2. Tenant and operation authorization

Host membership does not grant every hosted tenant the host's full rights.
Before selecting Fabric, GW must resolve the authenticated tenant and legal
organization, requested action, sector and jurisdiction, then derive the
permitted channel and chaincode operation from trusted policy.

This is the primary control that prevents:

- a non-provider tenant from writing provider data;
- an animal-sector provider from writing human-health data;
- a request from choosing a broader channel than its authorization;
- read permission from being treated as write permission.

Fabric ACLs, endorsement policies and chaincode authorization provide a second
enforcement layer. Channel membership alone is not a read/write policy.

### 3. Ledger identity binding

A channel name is not globally unique. Independent test and production networks
can both expose a channel with the same name. The SHA-256 fingerprint of its
serialized block zero binds a configured channel name to one concrete ledger.

The fingerprint does not authorize a host or tenant and does not select read or
write permission. It only detects connection to a different ledger.

Unit tests with simulated channels prove fail-closed routing and authorization
logic. They cannot prove that a deployed Kubernetes workload is connected to
the intended live ledger; block-zero verification provides that deployment
evidence.

## Desired operator contract

The final operator-facing switch is:

```text
LEDGER_GENESIS_VERIFICATION=false  # local/unit test profiles only
LEDGER_GENESIS_VERIFICATION=true   # persistent staging and production
```

With verification enabled, runtime/deployment automation must:

1. resolve the signed governance manifest for the approved host;
2. derive its exact channel, operation and chaincode policy;
3. obtain the expected block-zero fingerprint for every approved channel from
   that manifest or another authenticated governance registry;
4. fetch block zero through the configured peer and compare each fingerprint;
5. persist all verified bindings atomically;
6. initialize KMS and enable business traffic only after every check succeeds.

Do not implement automatic first-use trust by fetching an arbitrary peer's
block zero and accepting it as the expected value. That TOFU design cannot
detect a wrong or malicious network during the first startup. Automatic
operation remains auditable only when expected fingerprints come from a signed
governance source or a separately controlled deployment trust root.

## Current implementation limitation

As of runtime `1.20.5`, `scoped-v2` still requires these manual bootstrap
values in addition to `LEDGER_GENESIS_VERIFICATION=true`:

- `LEDGER_CHANNEL_GENESIS_SHA256` with one expected fingerprint per channel;
- `LEDGER_CHANNEL_CHAINCODE_ALLOWLIST` with the exact channel-to-chaincode map.

Therefore it is not yet correct to claim that the boolean alone is sufficient.
Removing those manual values requires a typed, signed governance-manifest
resolver and tests proving signature validation, tenant operation boundaries,
read/write separation, atomic binding, mismatch rejection and first-startup
failure when no trusted expected fingerprint exists.

## Audit evidence

Retain at least:

- signed host authorization and its digest;
- governance manifest identifier, version, issuer and signature result;
- resolved host/tenant/channel/action decision;
- expected and observed block-zero fingerprints;
- peer/MSP identity used for observation;
- atomic binding result and timestamp;
- denial events for unauthorized channels, chaincodes and write operations.

Never log private keys, bearer tokens, unnecessary personal data from the PDF
or ledger payload plaintext merely to prove these controls.
