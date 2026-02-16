# Fabric Multicloud Blueprint (GKE + Arsys)

This folder contains the bootstrap scripts, configuration templates, and K8s
manifests for a multi-cloud Hyperledger Fabric deployment aligned with the
UNID governance model and the channel taxonomy defined for Global Data Care.

## Contents

- `configtx/` : `configtx.yaml` template with channels and MSP placeholders.
- `scripts/`  : bootstrap scripts (configtxgen, channel create/join, anchor peers).
- `k8s/`      : Kubernetes templates for orderer/peer/CA (placeholders).

## Environments

All outputs are environment-scoped:
- `artifacts/test/`
- `artifacts/prod/`

Use `--env test|prod` when generating PKI to keep test/prod separate.

## Bootstrap flow (high-level)

1) Generate PKI materials:
   - Root CA (UNID)
   - ICA (UNID)
   - Host / Member certs per org

2) Generate `configtx.yaml` and channel artifacts.

3) Bring up orderer + peers in each cluster/namespace.

4) Create channels and join peers.

5) Set anchor peers and deploy chaincode.

## Channel list (v1)

Global:
- `global-identity-person`
- `global-identity-organization`
- `global-index-dog`
- `global-index-cat`
- `global-health-twins`

EU:
- `eu-identity-dog`, `eu-identity-cat`
- `eu-health-care`
- `eu-vet-dog`, `eu-vet-cat`
- `eu-health-thing`

NA/APAC:
- `na-health-care`
- `na-vet-dog`, `na-vet-cat`

SA (SADC):
- `sa-health-care`

## Orderer scaling (prod)

Start with a single UNID orderer. When ready, migrate to 5 orderers
with Raft multi-org participation (UNID + partners). See the blueprint
document for the recommended migration steps.

## Next step

See `docs/04-DEEP-DIVES/04.I-FABRIC-MULTICLOUD-BLUEPRINT.md` for the full plan.
