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

## Current Document Inventory In This Folder

- `00-project-closeout-todo.md`
  - closeout status register and remaining gaps
- `01-newbie-audit-runbook.md`
  - shortest reproducible local audit path
- `02-current-state-traceability.md`
  - exact statement of what the packaged local proof already demonstrates
- `03-identity-ledger-contract-plan.md`
  - current identity-ledger contract split and remaining ledger-model rationale
- `04-trust-bundle-operator-roles.md`
  - operational role split for Root CA, ICA, host, tenant/member, and local Fabric ownership
- `05-project-closure-use-cases-and-lifecycles-summary.md`
  - use cases, lifecycle map, SDK surfaces, and reproducible local stack references
- `06-project-closure-executive-summary.md`
  - executive/project-memory draft in Spanish for Word/PDF conversion

## Current Closeout Matrix

| Item | Status | Notes |
| --- | --- | --- |
| Local Fabric multi-channel devnet | Done | `identity-local` + `health-care-local` validated |
| Local `consentaccess-sc` lifecycle through GW CORE | Done | `activate -> revoke -> reactivate` validated on-chain |
| Identity/public-key traceability contract design | Done | documented in `docs-internal/03-identity-ledger-contract-plan.md` |
| `identity-local` audited smart-contract deployment flow | Done | `organization-sc`, `cryptographickey-sc`, `subjectkeybinding-sc`, `artifact-sc`, `artifactevent-sc`, `employee-sc`, `evidence-sc`, and `credential-sc` deploy and commit locally |
| GW CORE onboarding writes to identity ledger | Done | tenant organization, cryptographic keys, and subject-key bindings validated on `identity-local` |
| Inter-tenant contract VC semantic model | Done | closed in `docs-internal/03-identity-ledger-contract-plan.md` and aligned with GW/common-utils tests |
| Canonical local demo individual bootstrap | Done | default alias remains `Doraemon` |
| Wrapper command for newbie/auditor demo | Done | `npm run project:audit:demo` |
| Internal traceability docs separate from `docs-v2` | Done | this `docs-internal/` folder |
| Cross-repo newbie runbook | Done | `docs-internal/01-newbie-audit-runbook.md` |
| Exact current-state traceability note | Done | `docs-internal/02-current-state-traceability.md` |
| Trust bundle operator-role note | Done | `docs-internal/04-trust-bundle-operator-roles.md` |
| Detailed use-case and lifecycle closeout annex | Done | `docs-internal/05-project-closure-use-cases-and-lifecycles-summary.md` |
| Executive summary / project-memory draft | Done | `docs-internal/06-project-closure-executive-summary.md` |
| `compat/legacy` packaged end-to-end runner | Pending | SDK/GW path exists conceptually, but this repo does not yet expose one audited single-command local wrapper |
| `strict` packaged end-to-end runner | Pending | no audited local single-command path yet |
| Deterministic keypair proof in closeout runbook | Pending | must be tied to the concrete compat runner, not documented aspirationally |
| ML-KEM / ML-DSA strict transport/signature proof | Pending | target capability, not closeout evidence today |
| Digital twin search inside the main closeout lifecycle | Pending | separate capability exists, but not yet folded into the canonical demo wrapper |
| Formal closeout acceptance checklist signed against artifacts | Pending | should reference exact log and test outputs |
| Local devnet fully vendored into `gwtemplate-node-ts` | Pending | local wrappers already live here, but the underlying Fabric devnet still comes from `../fabric-multicloud/devnet/fabric-v3` |

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
- Post-quantum transport/signature evidence is not yet demonstrated by this
  repository alone.
- Digital twin search is not yet part of the canonical local closeout wrapper.
- Current consent lifecycle proof is revocation/reactivation based. It is not a
  hard-delete lifecycle proof.
- `cryptographickey-sc` direct reads are proven, but the current
  `listKeysByOrg` query helper still needs follow-up for `urn:gdc:...`
  organization ids.

## TODO: Local Devnet Extraction

Goal:

- make the reproducible `local-network` flow runnable without depending on the
  sibling `../fabric-multicloud/devnet/fabric-v3` path

Current coupling points:

- `scripts/bootstrap-local-fabric-stack.mjs`
- `scripts/prepare-consentaccess-local-fabric-env.sh`
- `scripts/ensure-fabric-devnet-env.sh`
- `chaincode/scripts/consentaccess-local-devnet.sh`
- PKI scripts that default `FABRIC_MULTICLOUD_DIR` to `../fabric-multicloud`

Target local-only layout in this repo:

- `local-devnet/fabric-v3/docker-compose*.yml`
- `local-devnet/fabric-v3/scripts/00-copy-dev-cas.sh`
- `local-devnet/fabric-v3/scripts/01-up-cas.sh`
- `local-devnet/fabric-v3/scripts/02-bootstrap-network.sh`
- `local-devnet/fabric-v3/scripts/04-generate-backend-env.sh`
- `local-devnet/fabric-v3/organizations/` and channel-artifact outputs generated locally

Execution plan:

1. Copy or rewrite the minimum devnet assets needed for:
   - CA startup
   - network bootstrap
   - backend env generation
2. Introduce one local root variable, for example:
   - `LOCAL_FABRIC_DEVNET_DIR=${ROOT}/local-devnet/fabric-v3`
3. Update the current local wrappers to prefer that local path and only fall
   back to `../fabric-multicloud/devnet/fabric-v3` during migration.
4. Update PKI/devnet docs so `local-network` no longer looks coupled to staging
   or multicloud workspaces.
5. Add one CI-safe smoke that proves the local wrappers resolve the local path.

What must be executed to prove the extraction:

From `gwtemplate-node-ts`:

```bash
npm run pki:bundle -- --config scripts/examples/trust-bundle.local.example.json
npm run local:fabric:stack
bash ./scripts/smoke-consentaccess-local-network.sh
bash ./scripts/smoke-consentaccess-lifecycle-local-network.sh
```

Optional end-to-end follow-up:

```bash
cd "$HOME/GITS/gdc-workspace/gdc-sdk-node-ts"
npm run test:e2e:live-full-cycle
```

Acceptance criteria for this TODO:

- local Fabric bootstrap no longer requires `../fabric-multicloud/devnet/fabric-v3`
- docs reference the local vendored devnet first
- the audited local lifecycle still passes with `identity-local` and `health-care-local`
