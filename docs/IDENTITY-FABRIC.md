## Identity Fabric (Ledger Registry)

This document defines the minimal ledger schema for the identity registry used in the `eu-identity` channel. The registry stores organization identifiers, sector-specific DIDs, and cryptographic keys for auditability, lifecycle status, and verification support. The ledger is not a DID resolver; verifiers still resolve DID documents and VCs via `/.well-known`.

### Design principles
- Store only the current state in assets (no embedded history).
- Use Fabric history (`GetHistoryForKey`) when historical events are required.
- Use Unix epoch seconds for all timestamps to avoid timezone/format ambiguities.
- Support multiple DIDs per organization by sector/service.

### Organization asset (contract: `organization`)
**Asset ID:** `<country>_<idType>_<idValue>` (e.g., `ES_VAT_ESB12345678`)

Stored fields:
- `orgId` (string)
- `status` (string): `active | suspended | revoked`
- `createdAt` (number, epoch seconds)
- `updatedAt` (number, epoch seconds)
- `suspendedAt` (number | null)
- `revokedAt` (number | null)
- `didBySector` (object): `{ [sector]: { did, didDocHash, didDocHashAlg, updatedAt } }`
- `metadata` (object, optional): `{ legalName, jurisdiction, sector, ... }`

Example:
```json
{
  "orgId": "ES_VAT_ESB12345678",
  "status": "active",
  "createdAt": 1733886400,
  "updatedAt": 1733886400,
  "suspendedAt": null,
  "revokedAt": null,
  "didBySector": {
    "health-care": {
      "did": "did:web:hc.example.org",
      "didDocHash": "uXhJH8d...Q",
      "didDocHashAlg": "SHA-256",
      "updatedAt": 1733886400
    }
  },
  "metadata": {
    "legalName": "Connect Health SL",
    "jurisdiction": "ES"
  }
}
```

### Cryptographic key asset (contract: `cryptographicKey`)
**Asset ID:** `<orgId>_<kidOrThumbprint>`

Stored fields:
- `keyId` (string)
- `orgId` (string)
- `kid` (string)
- `thumbprint` (string, RFC7638 base64url)
- `kty` (string)
- `crv` (string)
- `alg` (string)
- `use` (string): `sig | enc | auth`
- `purpose` (string): `gaiax-vc-legacy | gaiax-vc-pqc | fabric-msp | comm-mlkem | ...`
- `status` (string): `active | suspended | revoked | expired`
- `createdAt` (number)
- `updatedAt` (number)
- `expiresAt` (number | null)
- `suspendedAt` (number | null)
- `revokedAt` (number | null)
- `origin` (string): `did:web | msp | manual`

Example:
```json
{
  "keyId": "ES_VAT_ESB12345678_kid-legacy-1",
  "orgId": "ES_VAT_ESB12345678",
  "kid": "kid-legacy-1",
  "thumbprint": "o9T2m3...KQ",
  "kty": "EC",
  "crv": "P-384",
  "alg": "ES384",
  "use": "sig",
  "purpose": "gaiax-vc-legacy",
  "status": "active",
  "createdAt": 1733886400,
  "updatedAt": 1733886400,
  "expiresAt": 1765422400,
  "suspendedAt": null,
  "revokedAt": null,
  "origin": "did:web"
}
```

### Contract APIs
Organization:
- `CreateOrganization(orgId, payload)`
- `GetOrganization(orgId)`
- `UpdateOrganizationStatus(orgId, status, ts)`
- `UpsertDidBySector(orgId, sector, did, didDocHash, didDocHashAlg, ts)`
- `GetOrganizationHistory(orgId)` (uses Fabric `GetHistoryForKey`)

Cryptographic keys:
- `RegisterKey(keyId, payload)`
- `RegisterKeysBatch(orgId, keys[])` (server-side loop, single transaction)
- `GetKey(keyId)`
- `ListKeysByOrg(orgId)`
- `ListActiveKeysByOrg(orgId, use?, purpose?)`
- `UpdateKeyStatus(keyId, status, ts)`
- `GetKeyHistory(keyId)` (uses Fabric `GetHistoryForKey`)

### Notes
- `RegisterKeysBatch` accepts an array so key rotation can be atomic and reduce round trips. Internally it should validate and write each key to state within a single transaction.
- VC URLs are derivable from `did:web` via `/.well-known` and do not need to be stored on-ledger.
- The ledger provides integrity and lifecycle metadata, while DID/VC resolution remains off-ledger.
