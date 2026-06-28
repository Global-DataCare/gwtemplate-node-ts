# Current State Traceability

Status date: 2026-06-28

## Purpose

This note records what has been demonstrated in the current local closeout path
and what remains intentionally out of scope for the packaged proof.

## Current Packaged Proof In This Repo

Command:

```bash
npm run project:audit:demo
```

This wraps the validated sequence:

1. `npm run local:fabric:stack -- --restart-gw --bootstrap-individual`
2. `bash ./scripts/smoke-consentaccess-lifecycle-local-network.sh`

Default local channels:

- identity ledger channel:
  - `identity-local`
- healthcare/service data channel:
  - `health-care-local`

## What Has Been Proven

- local Fabric boots cleanly after reset
- CA and ICA containers start in the devnet
- orderer and peers join both local channels
- local backend env is generated for GW CORE
- `consentaccess-sc` is installed, approved, and committed on
  `health-care-local`
- the identity-ledger contracts are installed, approved, and committed on
  `identity-local`:
  - `organization-sc`
  - `cryptographickey-sc`
  - `employee-sc`
  - `evidence-sc`
  - `credential-sc`
  - `artifact-sc`
  - `artifactevent-sc`
  - `subjectkeybinding-sc`
- GW CORE can register hosted tenant organizations on `identity-local`
- GW CORE can register hosted tenant public keys on `cryptographickey-sc`
- GW CORE can register subject-to-key bindings on `subjectkeybinding-sc`
- GW CORE can create and update consent state that is reflected on-chain
- canonical local consent lifecycle history grows as expected:
  - activate -> revision `1`
  - revoke -> revision `2`
  - reactivate -> revision `3`

## What Was Intentionally Changed To Make The Demo Honest

- local channel defaults were made explicit for `local-network`
  - healthcare writes now target `health-care-local`
  - identity writes now target `identity-local`
- demo individual onboarding no longer depends on a fake signed PDF
- the default local demo path now uses the KYC/OTP-style onboarding branch
- `Doraemon` remains the reusable canonical demo alias for the individual

## What Is Not Yet Proven By The Packaged Wrapper

- identity artifact/evidence writeback from ICA `_verify`
- a one-command `compat/legacy` local audited wrapper
- a one-command `strict` local audited wrapper
- deterministic keypair generation tied to a published audited compat script
- ML-KEM encrypted transport proof
- ML-DSA signed transport proof
- digital twin search embedded into the same packaged closeout lifecycle
- hard delete of consent state as the canonical on-chain lifecycle outcome

Residual query gap:

- direct reads of `cryptographickey-sc` and `subjectkeybinding-sc` are proven
- the current `listKeysByOrg` query path still returns an empty list for
  `urn:gdc:...` tenant ids and should be treated as a follow-up query/index bug,
  not as missing onboarding writes

The missing identity part is now specified in:

- `docs-internal/03-identity-ledger-contract-plan.md`

## Cross-Repo Evidence That Already Exists But Is Separate

The wider lifecycle story is distributed:

- `../gdc-sdk-node-ts/docs/101-LIVE_GW_LOCAL.md`
  - local SDK-to-GW live walkthrough
- `../gdc-sdk-node-ts/tests/101-live-full-cycle-bff-runtime.e2e.test.mjs`
  - broad backend/BFF full-cycle proof
- `../gdc-sdk-node-ts/tests/live-dialogue-consent-professional-access.e2e.test.mjs`
  - dialogue/consent actor interaction proof
- `../gdc-sdk-node-ts/tests/resource-operations.test.mjs`
  - SDK consent and digital twin operation coverage
- `docs-v2/24-local-audit-fabric-runtime.md`
  - canonical integrator-facing local Fabric baseline in this repo

These references are useful, but they must not be described as if this repo
already wrapped all of them into one audited command.
