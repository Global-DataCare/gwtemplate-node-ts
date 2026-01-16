## Fabric v3 deterministic devnet (development-only)

This folder provides a reproducible local Fabric v3 network to test:
- public vs private chaincode flows,
- ledger-safe tags (no `display`),
- idempotent "research registered" flags,
- and backend gateway integration (`@hyperledger/fabric-gateway`).

### Determinism note

Fabric certificates issued by a CA can vary per run, but you can make the **CA keys deterministic**
by seeding them and persisting the resulting `ca-key.pem`/`ca-cert.pem` (dev-only).

This repo already includes dev CA material under:
- `gwtemplate-node-ts/artifacts/fabric-ca-server-root`
- `gwtemplate-node-ts/artifacts/fabric-ca-server-ica`

The scripts below copy that material into this devnet and start the CA containers.

### Quick start

From `gwtemplate-node-ts/devnet/fabric-v3`:

**DEMO-style (single host peer, tenants are clients)**:
`export SINGLE_HOST=true`

1) Copy deterministic CA keys/certs (dev-only):
`./scripts/00-copy-dev-cas.sh`

2) Start CAs:
`./scripts/01-up-cas.sh`

3) Bootstrap MSPs + channel artifacts, then start orderer/peers:
`./scripts/02-bootstrap-network.sh`

4) Deploy a chaincode (parameterize `CHAINCODE_PATH`, `CHAINCODE_NAME`, etc.):
`./scripts/03-deploy-chaincode.sh`

5) Generate backend env (`HLF_CONNECTION_PROFILE_*`, `HLF_CERTIFICATE_*`, `HLF_PRIVATE_KEY_*`):
`./scripts/04-generate-backend-env.sh`

Then run the backend using that env file:
`cd ../../ && dotenvx run -f devnet/fabric-v3/.env.fabric-devnet -- npm test -- src/__tests__/unit/...`

### What still needs to be wired

This devnet is chaincode-agnostic, but you still need to:
- point `CHAINCODE_PATH` to your public/private chaincode repos
- add backend managers that call Fabric and persist `audit.txId/txTime`

### Multi-org mode (optional)

If you need multi-org endorsement/policy testing:
`export SINGLE_HOST=false`
and rerun `./scripts/02-bootstrap-network.sh` (it will enroll Org2 and start `peer0-org2`).
