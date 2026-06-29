## Trust Bundle and Local Network Runbook

Status: Current reproducible PKI/bootstrap contract for local operators.

### Goal

Make the trust material reproducible before starting the application stack:

- Root CA
- ICA
- host
- member or tenant
- published `did.json`
- published `jwks.json`
- published `x509.der`
- audit `manifest.json`

This runbook also fixes where the full local lifecycle belongs when Fabric runs
as `local-network`.

### Ownership Split

Use this repo as the operational anchor for local reproducibility.

- `gwtemplate-node-ts`
  - generates trust artifacts
  - boots local Fabric devnet
  - prepares `.env.local-fabric`
  - starts GW CORE
  - runs the packaged local demo
- `dataspace-ica-ts`
  - serves ICA runtime and public trust endpoints
  - consumes the generated ICA artifacts as published `.well-known` content
- `gdc-sdk-node-ts`
  - runs consumer-side lifecycle and dialogue tests against the running GW and ICA

Do not make `gdc-sdk-node-ts` the source of truth for local infra bootstrap.
It is the top-level consumer proof, not the infrastructure owner.

Also keep this environment split explicit:

- `local-network` here means the deterministic local Fabric devnet used for
  reproducibility
- it does not mean staging, shared multicloud, or company-specific infra
- those broader topologies must stay documented as separate environments

### Current Local Devnet Packaging

Current state:

- trust generation already lives in `gwtemplate-node-ts`
- local Fabric orchestration entrypoints also live in `gwtemplate-node-ts`
- but the underlying Fabric devnet files still live in
  `../fabric-multicloud/devnet/fabric-v3`

So today the local audited flow uses some of the same low-level devnet scripts
as the broader infrastructure workspace, while still keeping a different
runtime profile:

- local channels: `identity-local`, `health-care-local`
- local env file: `.env.local-fabric`
- local GW entrypoint: `npm run local:fabric:stack`

If complete repository-level separation is required, the next clean step would
be to vendor a minimal `local-devnet/` bundle into `gwtemplate-node-ts` and
point the current wrappers to that local-only path.

### Public Key Rules

Keep these invariants explicit:

- the credential-signing public key is the same in:
  - `did.json`
  - `jwks.json`
  - the leaf X.509 certificate embedded in `x5c`
- `x5c` is the primary reproducible publication mechanism
- `x5u` and `/.well-known/x509.der` are complementary publication endpoints
- PQ messaging keys are separate from credential-signing keys
- Fabric operational keys are separate from credential-signing keys

Recommended deterministic separation:

- `trust/root-ca`
- `trust/ica`
- `trust/host`
- `trust/member/<name>`
- `fabric/<org>`
- `messaging-pq/<org>`

Same seed root is acceptable for local reproducibility. Reusing the exact same
keypair across JOSE/DID and Fabric is not recommended.

### Generated Files

Each generated entity directory now contains:

- `did-<domain>.json`
- `jwks-<domain>.json`
- `x509.der`
- `x509-chain.der`
- `manifest.json`
- the entity-specific DER/PEM files already emitted by the script

`manifest.json` is the minimal audit artifact. It records:

- role
- domain
- DID
- legal registration number
- SHA-256 of the published files

### One-Command Trust Bundle

Use:

```bash
npm run pki:bundle -- --config scripts/examples/trust-bundle.local.example.json
```

The config file defines:

- which organization JSON is used for Root CA, ICA, host, and members
- deterministic seed per entity
- KDF mode and context labels

The provided local example already points to this repo's own inputs:

- `pki-inputs/test/ca-organization.json`
- `pki-inputs/test/ica-organization.json`
- `pki-inputs/test/host-organization.json`
- `pki-inputs/test/member-organization.json`

If `artifacts/test/pki-*` already exists, the generators will ask whether they
should overwrite those directories.

### Script Responsibilities

- `npm run pki:root`
  - generates deterministic Root CA material
- `npm run pki:ica`
  - generates ICA keypair and ICA certificate signed by the Root CA
- `npm run pki:host`
  - generates host keypair and host certificate signed by the ICA
- `npm run pki:member`
  - generates member or tenant keypair and certificate signed by the ICA
- `npm run pki:bundle`
  - orchestrates the chain in one sequence

### Publication Contract for ICA

The generated ICA directory under `artifacts/test/pki-ica/<MSP_ID>/` is the
publication input for `dataspace-ica-ts`.

The intended runtime contract is:

- `/.well-known/did.json`
  - served from `did-<domain>.json`
- `/.well-known/jwks.json`
  - served from `jwks-<domain>.json`
- `/.well-known/x509.der`
  - served from `x509.der`

`dataspace-ica-ts` should load those generated files directly instead of
reconstructing the public identity on the fly.

### Local Network Lifecycle

For a reproducible local stack with Fabric `local-network`, the order is:

1. generate trust artifacts from this repo
2. start or configure `dataspace-ica-ts` with the generated ICA public artifacts
3. bootstrap local Fabric devnet from this repo and `fabric-multicloud`
4. run `npm run prepare:local-fabric-env`
5. run `npm run local:fabric:stack` or `npm run api:local-fabric`
6. run SDK live lifecycle suites from `gdc-sdk-node-ts`

The important boundary is:

- local trust and Fabric bootstrap belong here
- broader dialogue and end-user lifecycle proof belongs in `gdc-sdk-node-ts`

### Minimum Reproducible Local Sequence

From `gwtemplate-node-ts`:

```bash
cd "$HOME/GITS/gdc-workspace/gwtemplate-node-ts"
npm run pki:bundle -- --config scripts/examples/trust-bundle.local.example.json
npm run local:fabric:stack
```

Then from `gdc-sdk-node-ts`:

```bash
cd "$HOME/GITS/gdc-workspace/gdc-sdk-node-ts"
npm run test:e2e:live-full-cycle
```

If `dataspace-ica-ts` is part of the proof, start it with the ICA artifacts
generated in the first step before running the SDK suite.
