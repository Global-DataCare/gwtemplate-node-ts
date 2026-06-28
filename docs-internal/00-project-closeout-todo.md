# GW CORE Project Closeout TODO

Status date: 2026-06-28  
Audience: project leadership, internal engineering, examiners, and auditors.

This folder is intentionally separate from `docs-v2/`.

- `docs-v2/*` remains the integrator-facing and contract-facing documentation path.
- `docs-internal/*` is the semi-internal traceability layer for project status,
  acceptance evidence, and closeout gaps.

## Proven Now

- Local Fabric bootstrap is reproducible from `gwtemplate-node-ts` with:
  - `identity-local`
  - `health-care-local`
- `consentaccess-sc` deploys and commits on `health-care-local`.
- GW CORE starts with `.env.local-fabric`.
- Tenant bootstrap works for `acme-id`.
- Demo individual onboarding works through the KYC/OTP path without requiring
  a fake FNMT-signed PDF.
- Consent lifecycle is validated on-chain against the local chaincode:
  - activate
  - revoke
  - reactivate
- Current audited wrapper command:
  - `npm run project:audit:demo`

## Current Closeout Matrix

| Item | Status | Notes |
| --- | --- | --- |
| Local Fabric multi-channel devnet | Done | `identity-local` + `health-care-local` validated |
| Local `consentaccess-sc` lifecycle through GW CORE | Done | `activate -> revoke -> reactivate` validated on-chain |
| Identity/public-key traceability contract design | Done | documented in `docs-internal/03-identity-ledger-contract-plan.md` |
| Canonical local demo individual bootstrap | Done | default alias remains `Doraemon` |
| Wrapper command for newbie/auditor demo | Done | `npm run project:audit:demo` |
| Internal traceability docs separate from `docs-v2` | Done | this `docs-internal/` folder |
| Cross-repo newbie runbook | Done | `docs-internal/01-newbie-audit-runbook.md` |
| Exact current-state traceability note | Done | `docs-internal/02-current-state-traceability.md` |
| `compat/legacy` packaged end-to-end runner | Pending | SDK/GW path exists conceptually, but this repo does not yet expose one audited single-command local wrapper |
| `strict` packaged end-to-end runner | Pending | no audited local single-command path yet |
| `identity-local` audited smart-contract deployment flow | Pending | organization/employee/key contracts exist, but the missing `subjectkeybinding-sc` plus GW wiring are not yet packaged and validated |
| Deterministic keypair proof in closeout runbook | Pending | must be tied to the concrete compat runner, not documented aspirationally |
| ML-KEM / ML-DSA strict transport/signature proof | Pending | target capability, not closeout evidence today |
| Digital twin search inside the main closeout lifecycle | Pending | separate capability exists, but not yet folded into the canonical demo wrapper |
| Formal closeout acceptance checklist signed against artifacts | Pending | should reference exact log and test outputs |

## Mandatory Evidence For Project Closure

The minimum evidence package should contain:

1. Demo/local proof
   - `npm run project:audit:demo`
   - wrapper logs under `logs/project-audit-demo-*`
   - Fabric/GW bootstrap logs under `logs/local-fabric-stack-*`
2. SDK live proof
   - current local runbook from `../gdc-sdk-node-ts/docs/101-LIVE_GW_LOCAL.md`
   - preserved `../gdc-sdk-node-ts/test-results/*.jsonl`
3. ICA/GW controller proof
   - local or remote execution of the controller lifecycle suite
4. Gap register
   - explicit list of what is still pending at sign-off time

## Closeout Gaps That Must Not Be Misrepresented

- `compat/legacy` is not yet packaged here as a one-command audited local flow.
- `strict` is not yet packaged here as a one-command audited local flow.
- `identity-local` still lacks the audited end-to-end smart-contract proof for
  subject/key binding lifecycle.
- Post-quantum transport/signature evidence is not yet demonstrated by this
  repository alone.
- Digital twin search is not yet part of the canonical local closeout wrapper.
- Current consent lifecycle proof is revocation/reactivation based. It is not a
  hard-delete lifecycle proof.
