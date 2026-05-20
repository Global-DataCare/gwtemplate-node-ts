Status: Transitional

## Identity Fabric (Ledger Registry)

This document defines the minimal ledger schema for the identity registry used in the `eu-identity` channel. The registry stores organization identifiers, sector-specific DIDs, and cryptographic keys for auditability, lifecycle status, and verification support. The ledger is not a DID resolver; verifiers still resolve DID documents and VCs via `/.well-known`.

### CES mapping (Gaia-X)
Gaia-X introduces a Credential Event Service (CES) because there is no shared ledger. In this stack, the ICA makes the decision (issue/revoke/suspend) and Hyperledger Fabric is the shared source of truth. That means:
- Ledger state replaces CES events as the authoritative status feed.
- Verifiers should treat hosted VCs as presentation copies and confirm status against the ledger.
- History is retrieved from Fabric (`GetHistoryForKey`) rather than from a CES event stream.

### Design principles
- Store only the current state in assets (no embedded history).
- Use Fabric history (`GetHistoryForKey`) when historical events are required.
- Use Unix epoch seconds for all timestamps to avoid timezone/format ambiguities.
- Support multiple DIDs per organization by sector/service.
- Separate identity assets (organization/employee) from credential status and evidence to avoid unintended revocations.

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

### Employee (legal representative) asset (contract: `employee`)
**Asset ID:** `<orgId>_<employeeUuid>`

Stored fields:
- `employeeId` (string)
- `orgId` (string)
- `did` (string, optional)
- `didDocHash` (string, optional)
- `didDocHashAlg` (string, optional)
- `email` (string)
- `role` (string)
- `status` (string): `active | suspended | revoked`
- timestamps (`createdAt`, `updatedAt`, `revokedAt?`)

### Evidence asset (contract: `evidence`)
Use a separate contract for attestations/evidence linked to organizations or employees, without mutating the core identity asset.

**Asset ID:** `<subjectId>_<evidenceId>`

Stored fields:
- `evidenceId` (string)
- `subjectType` (string): `organization | employee | credential`
- `subjectId` (string)
- `evidenceType` (string): `kyc | license | id-check | ...`
- `hash` (string)
- `hashAlg` (string)
- `issuer` (string)
- `status` (string): `active | revoked | expired`
- timestamps (`issuedAt`, `expiresAt`, `revokedAt?`)

### Gateway ledger endpoints
These API endpoints query the ledger for credential status and history. They follow the standard CDS path pattern.

- `GET /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/ledger/credential/_status?id={credentialId}`
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/ledger/credential/_status` (async, returns `Location: .../_status-response?thid=...`)
- `GET /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/ledger/credential/_history?id={credentialId}`
- `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/ledger/credential/_history` (async, returns `Location: .../_history-response?thid=...`)

Network selection uses the runtime environment (same mapping as host registry sector):
- `demo/test` → `test`
- `development/staging` → `test-network`
- `production` → `network`

Channel resolution uses (in order):
1) `?channel=...`
2) tenant claims `addressCountry` → `{jurisdiction}-identity`
3) `LEDGER_IDENTITY_CHANNEL_DEFAULT` (defaults to `eu-identity`)

### Ledger routing (multi-network ready)
The service resolves ledger providers per network via environment variables:
- `LEDGER_PROVIDER_DEFAULT=mem`
- `LEDGER_PROVIDER_MAP=test=mem,test-network=mem,network=mem`

This keeps `network` as a logical routing layer so different environments can map to Fabric, Pontus-X, or other ledgers without changing endpoint paths.

Fabric adapter environment variables (used when `fabric` is selected):
- `LEDGER_FABRIC_MSP_ID=Org1MSP`
- `LEDGER_FABRIC_ITEM_TYPE=credential`

The Fabric adapter follows the standard contract naming pattern used in the legacy stack (via `ManageAsset` and per-item managers):
- Contract name: `${itemType}-sc`
- Read: `read${Cap(itemType)}`
- History: `get${Cap(itemType)}History`

For cryptographic key lifecycle, use a separate `itemType=cryptographicKey` and expose dedicated endpoints if needed.

### Notes
- `RegisterKeysBatch` accepts an array so key rotation can be atomic and reduce round trips. Internally it should validate and write each key to state within a single transaction.
- VC URLs are derivable from `did:web` via `/.well-known` and do not need to be stored on-ledger.
- The ledger provides integrity and lifecycle metadata, while DID/VC resolution remains off-ledger.
- The credential status lifecycle should be written by the ICA in a dedicated `credential` contract; the host should not mutate credential state after issuance.
