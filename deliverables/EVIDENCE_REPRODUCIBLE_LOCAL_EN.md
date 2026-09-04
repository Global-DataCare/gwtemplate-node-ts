# Reproducible local evidence

## Purpose

This tour allows you to demonstrate how the software works without accessing a cloud, real data or production secrets. It is not a migration or a productive deployment.

Prove with synthetic data:

1. data-space ICA, one-time host activation and issue
a VC Host without PDF or temporary DID;
2. Root CA e Fabric ICA disposable;
3. admission of `Host2MSP` into a network initially formed by `Host1MSP`;
4. installation using the `gdc-host` chart on kind;
5. peer, CouchDB, GW CORE, PostgreSQL, IPFS and nine CCAAS;
6. write, read, deny and persist after reboot.

## Execution

```bash
git clone https://github.com/Global-DataCare/gwtemplate-node-ts.git
git clone https://github.com/Global-DataCare/dataspace-ca-ts.git
git clone https://github.com/Global-DataCare/dataspace-ica-ts.git

cd gwtemplate-node-ts
npm ci

export DATASPACE_CA_ROOT="$(cd ../dataspace-ca-ts && pwd)"
export DATASPACE_ICA_ROOT="$(cd ../dataspace-ica-ts && pwd)"
export IMAGE_NAME="gw-core:local-evidence-$(git rev-parse --short HEAD)"

LOCAL_IMAGE_NAME="${IMAGE_NAME}" ./docker_build_local.sh
npm run evidence:open-source-production-readiness
```

The valid result contains `PASS` on all gates and a hash manifest under `artifacts/open-source-production-readiness/`.

## Limits of the evidence

- Does not migrate real data.
- Does not deploy an external ICA or host.
- Does not reuse VC, MSP, TLS, grants, Secrets or keys between environments.
- It does not replace acceptance of `test-network` or production.

The extensive explanation of the scope is in [`EVIDENCE_REPRODUCIBLE_HOST_EN.md`](./EVIDENCE_REPRODUCIBLE_HOST_EN.md).
