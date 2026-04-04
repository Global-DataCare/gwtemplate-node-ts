# Key Custody Runbook (GW)

## Scope

This runbook defines operational rules for tenant key custody in GW:

- `comm_enc_key`
- `vc_sign_key`
- `storage_dek`
- `hmac_obfuscation_key`

Each key purpose is isolated per tenant and versioned independently.

## Runtime Pattern

1. Persist key material as wrapped blobs.
2. Unwrap on demand by `tenant + purpose + version`.
3. Cache unwrapped material in-memory with:
   - short TTL (`KEY_MATERIAL_CACHE_TTL_MS`)
   - bounded size (`KEY_MATERIAL_CACHE_MAX_ENTRIES`)
4. Invalidate cache on rotation or key version changes.

## Modes

- `online`: root KEK in external KMS/HSM.
- `offline-single`: manual unseal at startup.
- `offline-multi`: pre-provisioned shared bootstrap secret for replicas (no interactive prompt per pod).

## Minimal Env (Staging Compat)

```bash
SECURITY_MODE=compat
FHIR_LEGACY=true
JSON_LEGACY=true
DIDCOMM_PLAIN=disabled
DEMO_ALLOW_INSECURE_BEARER=false

KEY_MATERIAL_CACHE_TTL_MS=300000
KEY_MATERIAL_CACHE_MAX_ENTRIES=1024
```

## Rotation Procedure

1. Create new wrapped key version per `tenant + purpose`.
2. Mark new version as active in metadata.
3. Invalidate runtime cache for affected tenant/purpose.
4. Verify new operations are using the new version.
5. Retire old version after grace period.

## Incident Procedure

1. Force cache flush.
2. Rotate affected key versions.
3. Reissue credentials/tokens that depend on compromised material.
4. Review audit trail by `tenantId + purpose + keyVersion`.
