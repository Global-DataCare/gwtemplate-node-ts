# 19 Key Custody and Audit Readiness

This file follows the shared narrative contract in
[01-narrative-contract.md](./01-narrative-contract.md).

Purpose:

- document the current GW key-custody model,
- state clearly what was fixed in tenant KMS persistence,
- state clearly what is still not strong enough for production audit sign-off,
- define the production target that replaces `KEK_SECRET` in `.env`.

This document is the source of truth for the current runtime custody posture.

Terminology rule:

- this document uses `HashiCorp Transit`, not just `Vault`,
- because GW already uses the word `vault` for persisted confidential storage,
- and mixing both concepts produces design and audit confusion.
- this document talks about the technical service/tenant custody layer, not
  the end-user `ProfileRuntime` that unlocks one user-owned profile in the
  SDK runtimes.

Runtime naming rule:

- `ProfileRuntime`
  unlocked end-user profile runtime
- `TenantServiceRuntime`
  technical wallet/runtime for tenant/BFF/service signing, encryption,
  DIDComm/plain wrapping, and confidential storage tasks

## Current State

GW now persists tenant and host operational key material as `wrapped_keys`
inside the host vault.

That means:

- tenant async plaintext response encryption no longer depends only on
  `_managedKeys` process memory,
- host keys can be rehydrated after restarts or pod hops,
- tenant keys can be rehydrated after restarts or pod hops,
- legacy tenants can still resolve a public tenant encryption key from the
  published `didDocument` when that public key exists but wrapped private
  material does not.

This fixed a real availability and tenancy bug:

- `_activate` could succeed,
- the tenant vault could exist,
- a later tenant route could still fail with
  `Could not retrieve public encryption key for recipient vault ...`
  if the serving process no longer had the old in-memory keyset.

## What This Does Not Mean

This does **not** mean the current setup passes a serious security audit
without caveats.

The main remaining weakness is the envelope root key source:

- today, wrapped-key persistence is rooted in `KEK_SECRET`,
- that value is supplied from process configuration,
- if it lives only in `.env`, the application still possesses the master
  wrapping secret in local plaintext configuration at boot.

That is better than losing tenant keys on restart, but it is not the same as
externalized root-key custody.

## Honest Audit Posture

The honest posture today is:

- better than the previous in-memory-only KMS behavior,
- materially safer for pod restart and rehydration,
- not yet a no-caveat production custody model.

Reasons:

1. The root wrapping secret is still process-local configuration.
2. Rotation, unwrap authorization, and key-usage audit evidence are not yet
   delegated to an external cryptographic control plane.
3. Legacy tenants may still exist without complete historical `wrapped_keys`,
   which requires explicit audit and migration handling.

## Why `KEK_SECRET` in `.env` Is the Weak Point

`KEK_SECRET` currently acts as the effective root secret for envelope wrapping.

If an attacker obtains:

- runtime environment dumps,
- CI/CD misconfiguration that exposes env vars,
- host-level secret injection output,
- compromised node/process memory soon after boot,

then they may obtain the secret that can unwrap persisted tenant key material.

That does not automatically expose every tenant document instantly, but it
means the strongest custody boundary is still local process configuration,
which is weaker than a managed KMS/HSM boundary.

## What Counts as the Production Target

The target is:

1. GW persists wrapped tenant/host key material in storage.
2. The wrapping root is not a raw `.env` secret.
3. Unwrap operations are mediated by an external KMS or HSM-backed service.
4. Rotation and access are auditable outside the app process.

Preferred target for GCP deployments:

- Cloud KMS or Cloud HSM for the root wrapping key,
- GW stores only wrapped operational key blobs,
- GW calls KMS for wrap/unwrap or decrypt operations,
- env/config stores only non-secret identifiers such as KMS key resource names.

Acceptable transitional posture:

- a secret manager may store configuration needed to reach KMS,
- but a secret manager holding one raw long-lived master KEK and handing it to
  the app at boot is still weaker than true KMS/HSM-backed custody.

In short:

- `Secret Manager` is helpful for configuration distribution,
- `KMS/HSM` is the real custody boundary.

## Supported Envelope Providers

The runtime root-custody provider names are:

- `memory`: dev/test only
- `local`: local compatibility mode using `KEK_SECRET`
- `gcp-kms`: GCP production target
- `hashicorp-transit`: open-source/self-hosted production target

These names are intentional:

- `hashicorp-transit` refers to the Transit cryptography engine,
- it does not refer to the GW confidential-storage vault model,
- so storage-vault and root-key-custody discussions stay separate.

## Configuration Matrix

The custody provider is independent from `SECURITY_MODE`.

That means:

- `SECURITY_MODE=demo` does not force `memory`
- `SECURITY_MODE=demo` can still use `local` with `KEK_SECRET`
- production-oriented custody decisions must be driven by
  `ENVELOPE_PROVIDER`

The intended matrix is:

1. `SECURITY_MODE=demo` + `ENVELOPE_PROVIDER=memory`
   - fastest dev/test path
   - no `KEK_SECRET`
   - no durable root-custody posture

2. `SECURITY_MODE=demo` + `ENVELOPE_PROVIDER=local`
   - deterministic configured root secret via `KEK_SECRET`
   - local/dev compatibility path
   - useful when operators explicitly want wrapped-key persistence rooted in a
     configured secret during demo or local environments

3. `SECURITY_MODE=compat|strict` + `ENVELOPE_PROVIDER=gcp-kms`
   - preferred GCP production path

4. `SECURITY_MODE=compat|strict` + `ENVELOPE_PROVIDER=hashicorp-transit`
   - preferred portable/open-source production path

Important clarification:

- `InMemoryEnvelopeAdapter` does not use `KEK_SECRET`
- if you want `KEK_SECRET`, use `ENVELOPE_PROVIDER=local`

## Why "Reprovision on Startup" Is Not the Right Fix

Reprovisioning tenant keys from active tenants on startup is not the intended
solution.

Why:

1. It can silently create new keys instead of restoring the old ones.
2. Historical encrypted tenant data may become unreadable.
3. Historical HMAC-backed indexes may no longer match.
4. Published tenant cryptographic identity can drift from stored data.

The correct model is persistence plus rehydration of the same key material,
not silent reprovisioning.

## Legacy Tenant Caveat

The rehydration fix protects tenants provisioned after wrapped-key persistence
was introduced.

Legacy tenants created before that change may still fall into three cases:

1. only the public encryption key is available in the tenant `didDocument`
   and async plaintext response encryption can still work,
2. wrapped private encryption material is missing and some decrypt paths may
   require controlled recovery or rotation planning,
3. storage/HMAC material is missing and historical confidential data or
   indexed search capability may be at risk.

This is why `npm run kms:audit -- --json` exists.

That audit is operationally important because it separates:

- missing public encrypt-to-self capability,
- missing confidential-data decryption capability,
- missing HMAC-backed index/search capability.

## Operational Checks Required

Before claiming production readiness for custody, operators should at minimum:

1. Run `npm run kms:audit -- --json`.
2. Confirm that host and active tenants have persisted `wrapped_keys`.
3. Confirm that no critical tenant depends only on volatile historical memory.
4. Confirm the deployment does not rely on raw `KEK_SECRET` in local plain env
   as the final intended security posture.

## Recommended Migration Plan

Phase 1: current state

- keep wrapped tenant/host keys in persistent storage,
- keep restart-safe rehydration,
- use `npm run kms:audit -- --json` to identify legacy gaps.

Phase 2: externalize root custody

- replace the local `AesGcmEnvelopeAdapter` root secret source with a Cloud KMS
  or HSM-backed adapter,
- store only KMS key identifiers in env/config,
- move unwrap authority from app-local plaintext secret material to the KMS
  boundary.

Phase 3: audit evidence

- document rotation procedure,
- document recovery procedure,
- document authorization to invoke unwrap operations,
- document legacy-tenant migration decisions and exceptions.

## Current Recommendation

The current implementation is good enough to say:

- tenant responsibility was restored correctly,
- restart/pod-hop behavior is no longer memory-fragile,
- the old workaround of encrypting tenant plaintext responses to the host is
  not the intended architecture.

But the current implementation is **not** enough to say:

- root-key custody is fully externalized,
- the deployment passes a production audit with no material findings.

That stronger claim should wait until `KEK_SECRET` is replaced by an external
KMS/HSM-backed root custody design.
