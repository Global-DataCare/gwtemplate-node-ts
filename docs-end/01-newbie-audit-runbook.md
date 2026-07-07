# Newbie Audit Runbook

> 101 note
> - This file is part of the packaged closeout/audit path in `docs-end`, not the main current integrator/runtime onboarding path.
> - For the active GW reading order, start in [../docs-v2/101-README.md](../docs-v2/101-README.md).
> - Use this runbook when the goal is reproducible local audit evidence.

Status date: 2026-06-28  
Audience: junior contributors, examiners, and auditors who need the shortest
reproducible local path.

## Goal

Starting from a fresh workspace, prove that:

- local Hyperledger Fabric boots with:
  - `identity-local`
  - `health-care-local`
- GW CORE starts against that local Fabric stack
- a canonical demo individual can be created
- consent lifecycle writes are committed on-chain through GW CORE

This is the current packaged local audit baseline. It is the recommended first
run before attempting broader SDK dialogue or ICA-hosted lifecycle suites.

## Trust Material First

If the local proof must include reproducible CA -> ICA -> host or tenant trust
material, generate it from this repo before starting the runtime stack:

```bash
npm run pki:bundle -- --config scripts/examples/trust-bundle.local.example.json
```

That produces:

- `did.json`
- `jwks.json`
- `x509.der`
- `manifest.json`

for the generated entities. The config file is a template and may need local
path adjustments for sibling repos.

## Repositories

Clone these sibling repositories under the same workspace directory:

- `fabric-multicloud`
- `gwtemplate-node-ts`
- `gdc-sdk-node-ts`
- `dataspace-ica-ts`

For the packaged local GW/Fabric audit demo in this repo, the first two are
required immediately:

- `fabric-multicloud`
- `gwtemplate-node-ts`

The other two are needed for broader cross-repo lifecycle demonstrations and
follow-up evidence.

Important scope note:

- `../fabric-multicloud/devnet/fabric-v3` is the current local deterministic
  Fabric devnet consumed by this repo
- do not present that local devnet as equivalent to any staging or multi-cloud
  infrastructure topology
- keep the local audited flow documented as a separate environment with its own
  channels, bootstrap commands, and runtime expectations
- staging, test-network, and production/multicloud topologies must stay
  documented separately

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop or Docker Engine with Compose support
- free local port `3000` for GW CORE
- enough Docker resources to start Fabric CA, orderer, peers, and tools

## Install Dependencies

Run `npm i` in each repo you cloned:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm i

cd "$HOME/GITS/gdc-workspace/gdc-sdk-node-ts"
npm i

cd "$HOME/GITS/gdc-workspace/dataspace-ica-ts"
npm i
```

Do not run `npm i` in `fabric-multicloud` root as part of this baseline. The
current local flow only requires the shell scripts under
`../fabric-multicloud/devnet/fabric-v3`.

## Fastest Current Proof

From `gwtemplate-node-ts`:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm run project:audit:demo
```

What this wrapper does:

1. resets and boots the local Fabric devnet
2. creates `identity-local` and `health-care-local`
3. prepares `.env.local-fabric`
4. deploys `consentaccess-sc`
5. starts GW CORE
6. bootstraps tenant `acme-id`
7. bootstraps the canonical demo individual
8. runs the consent lifecycle smoke:
   - activate
   - revoke
   - reactivate

## Expected Success Signals

- GW responds on:
  - `http://localhost:3000/host/cds-eu/v1/local-network/.well-known/ping`
- wrapper prints:
  - `[project-audit-demo] success`
- lifecycle smoke prints a final JSON payload with:
  - `network = local-network`
  - `channel = health-care-local`
  - three operations
  - history lengths `1`, `2`, `3`

## Where To Look For Logs

- wrapper logs:
  - `logs/project-audit-demo-<timestamp>/`
- stack/bootstrap logs:
  - `logs/local-fabric-stack-<timestamp>/`
- running GW pid:
  - `.local-fabric-gw.pid`

Useful examples:

- list recent wrapper runs:

```bash
ls -1dt logs/project-audit-demo-* | head
```

- inspect lifecycle stdout from the latest wrapper:

```bash
LATEST="$(ls -1dt logs/project-audit-demo-* | head -1)"
sed -n '1,220p' "${LATEST}/consent-lifecycle.stdout.log"
```

- stop GW if needed:

```bash
npm run local:close
```

## Current Cross-Repo Follow-Up

After the local baseline passes, the next current reference is in
`gdc-sdk-node-ts`:

- local live walkthrough:
  - `../gdc-sdk-node-ts/docs/101-LIVE_GW_LOCAL.md`
- canonical full-cycle suite:
  - `npm run test:e2e:live-full-cycle`
- controller-only lifecycle:
  - `npm run test:e2e:live-controller-lifecycle`

Important:

- those broader SDK runs are not yet folded into `npm run project:audit:demo`
- treat them as follow-up evidence, not as already-packaged one-command proof in
  this repo
- the infrastructure anchor stays in `gwtemplate-node-ts`; `gdc-sdk-node-ts`
  is the consumer-side validation layer, not the owner of local Fabric bootstrap

## Current Limits

- `compat/legacy` is not yet wrapped here as a single audited local command
- `strict` is not yet wrapped here as a single audited local command
- digital twin search is not yet included in the packaged local closeout flow
