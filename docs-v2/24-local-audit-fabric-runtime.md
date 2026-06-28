## Local Audit Runtime with Fabric

Status: Proposed local baseline for auditors, integrators, and junior contributors.

### Goal

Allow a local operator to run, on one workstation:

- the local ICA flow already used by the Node lifecycle tests,
- GW CORE,
- and one deterministic local Hyperledger Fabric devnet,

so the end-to-end runtime is inspectable without depending on cloud peers.

### What already exists

Current repo/runtime support already covers these pieces:

- GW CORE local demo runtime: `npm run api:local-demo`
- GW CORE local Fabric runtime: `npm run prepare:local-fabric-env` then `npm run api:local-fabric`
- deterministic Fabric v3 devnet owned by `../fabric-multicloud/devnet/fabric-v3`
- local Fabric Root CA and Fabric ICA CA containers in that devnet
- consent-access blockchain writes from GW CORE through `BlockchainAdapterFabric`
- credential-status/history reads through `CredentialLedgerAdapterFabric`

Relevant source anchors:

- `scripts/prepare-consentaccess-local-fabric-env.sh`
- `src/bootstrap/build-managers.ts`
- `src/adapters/BlockchainAdapterFabric.ts`
- `src/adapters/CredentialLedgerAdapterFabric.ts`
- `src/managers/ConsentManager.ts`

### Current local channel reality

Do not document a local `research` channel as if it already existed.

Today the recommended naming split is:

- `local-network` local healthcare channel: `health-care-local`
- `local-network` local identity channel: `identity-local`
- `test-network` and `network` keep the existing regional naming until the
  shared infra is renamed explicitly

So for the local baseline:

- use `health-care-local` as the canonical local healthcare channel,
- use `identity-local` as the canonical local identity channel,
- keep research as explicit extension scope,
- add a local research channel only when infra and backend contracts define it concretely.

### Recommended local responsibility split

For the current phase, keep Fabric writes centralized in GW CORE, not in `dataspace-node-ts` ICA.

Reason:

- the canonical onboarding flow is already host `Organization/_transaction` forwarding to ICA `_verify`
- GW CORE already owns the post-verification business state, tenant state, and async audit boundary
- splitting writes between ICA and GW now would create two partially authoritative audit trails
- local operators need one place to inspect whether a business action reached Fabric

Therefore:

- ICA verifies signed evidence and returns proof/result
- GW CORE decides whether the verified result must be anchored on-chain
- GW CORE submits Fabric transactions through its adapters

Legacy note:

- `Organization/_activate` remains compatibility-only
- if a local flow still starts from legacy proof material, GW CORE should remain the component that writes the resulting activation/audit anchors

### Recommended staged scope

#### Stage 0: local operator baseline

The minimum local stack for auditors/integrators is:

1. local ICA
2. local GW CORE
3. local Fabric devnet with:
   - Root CA
   - Fabric ICA CA
   - orderer
   - `peer0-org1`
4. local channels:
   - `health-care-local`
   - `identity-local`

This is enough for:

- onboarding tests,
- consent-access blockchain proofs,
- inspection of peer/channel/chaincode behavior,
- and reproducible bug reports.

#### Stage 1: keep real writes narrow

Use real Fabric writes only for flows that already have a clear chaincode contract.

Current safe candidate:

- consent-access rules from `ConsentManager`

Do not force all FHIR writes on-chain yet.

#### Stage 2: add generic hash/version anchoring from GW CORE

GW CORE managers already call `registerFhirCidMappings(...)` after storing:

- `Composition`
- `DocumentReference`
- `Observation`
- `RelatedPerson`

But the current Fabric blockchain adapter does not yet implement `registerCidVersionMappings(...)`.

So the next clean increment is:

1. define one dedicated chaincode for CID/version anchoring
2. implement `IBlockchainAdapter.registerCidVersionMappings(...)` in `BlockchainAdapterFabric`
3. keep the existing manager hooks as the caller side

This is a better first step than making ICA write PDF hashes directly to its own peer.

#### Stage 3: tenant meta-claim anchoring

Employee meta-claims, permissions, IPS publication markers, and similar tenant assertions should not be pushed ad hoc into the consent-access chaincode.

They need one explicit contract per asset family, for example:

- employee status / role / disable / purge audit
- permission or grant audit
- IPS bundle publication/hash anchor
- representative/controller binding audit

If the smart contract does not exist yet, document the asset family as extension scope and keep the runtime storage off-chain for now.

### Local bootstrap

From `gwtemplate-node-ts`:

```bash
npm run prepare:local-fabric-env
npm run api:local-fabric
```

Or use the Node orchestrator that performs the local stack bootstrap end to end:

```bash
npm run local:fabric:stack
```

Default behavior of that orchestrator:

1. bootstrap local Fabric CA + ICA + peer/orderer devnet
2. generate backend Fabric env
3. prepare `.env.local-fabric`
4. deploy local `consentaccess-sc`
5. start GW CORE in background
6. bootstrap tenant `acme-id`

Optional individual bootstrap:

```bash
npm run local:fabric:stack -- --bootstrap-individual
```

What that script expects and merges:

- base local GW env from `.env.local-demo`
- Fabric connection material generated by `../fabric-multicloud/devnet/fabric-v3/scripts/04-generate-backend-env.sh`

If the devnet is not up yet, bootstrap it first:

```bash
cd ../fabric-multicloud/devnet/fabric-v3
./scripts/00-copy-dev-cas.sh
./scripts/01-up-cas.sh
./scripts/02-bootstrap-network.sh
./scripts/04-generate-backend-env.sh
```

Optional local smoke for the existing on-chain path:

```bash
bash ./scripts/smoke-consentaccess-local-network.sh
bash ./scripts/smoke-consentaccess-lifecycle-local-network.sh
```

### Decision record

For the local audit profile, adopt these rules:

- one local Fabric devnet, not separate ad hoc ledgers per service
- one canonical local healthcare channel: `health-care-local`
- one canonical local identity channel: `identity-local`
- research channel is future work until infra and contracts exist
- GW CORE is the only component that writes business/audit anchors to Fabric
- ICA remains verification-first, not ledger-first
- new on-chain families require dedicated chaincode contracts, not generic dumping of claims

### Next implementation backlog

1. Add one `docs-v2` or `TESTING.md` walkthrough that starts ICA + GW + Fabric + SDK lifecycle tests in one sequence.
2. Implement `registerCidVersionMappings(...)` in `BlockchainAdapterFabric` plus a dedicated chaincode.
3. Define whether `DocumentReference` anchoring uses `contenthash` only or `identifier + contenthash`, and keep docs/tests aligned.
4. Add one explicit local integration test that proves a stored `DocumentReference` or `Composition` produced one on-chain hash/version anchor.
5. Only after that, decide whether employee and permission claims need their own ledger contract or remain host-audit data.
