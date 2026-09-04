# Reproducible data-space host evidence

This public repository is the entry point for the deliverable. It contains the GW CORE, the necessary chaincodes, a local two-host Hyperledger Fabric network, the host Helm chart, and E2E flows. It does not require the network's private operational repository.

The so-called "SEDIA runner" is not Helm, nor a tool supplied or approved by SEDIA. It is the informal name of the public collector `scripts/collect-open-source-production-readiness-evidence.sh`, run by `npm run evidence:open-source-production-readiness`. Its function is to execute tests and gather states, sanitized logs, summary and hashes for memory.

## Public images used by the deliverable

The two verified `linux/amd64` images are publicly available on GitHub Container Registry:

- [GW CORE](https://github.com/orgs/Global-DataCare/packages/container/package/gw-core):
`ghcr.io/global-datacare/gw-core@sha256:724ba328915d9907d7254c7eeded845d70dc1ae05881bccff630e871fbc7389f`.
- [Runtime CCAAS](https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime):
`ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac`.

The first one runs GW CORE. The second contains the nine chaincode servers and selects each contract using `CHAINCODE_NAME`. It does not replace CCAAS packages: their package IDs depend on the exact Services in the release and are generated after setting the Helm name and namespace.

## What it demonstrates

The evidence is divided into two complementary doors:

1. **Docker/local-network**, canonical functional test. Raise a Root and a
Disposable CA issuer, Root CA and Fabric ICA, orderer, `Host1MSP`,
`Host2MSP`, channels, chaincodes, GW CORE, PostgreSQL and IPFS. Execute the registration
of the tenant, Consent, SMART access allowed and denied, reboot and
persistent recovery.
2. **Helm/Kubernetes**, portability test. Create an isolated `kind` cluster,
load the same GW image by digest, install a peer with unique identity
of the newly supported `Host2MSP`, CouchDB, GW CORE, PostgreSQL, IPFS and nine CCAAS runtimes, and joins
the peer to the channels of the Fabric Docker `local-network`. Install on that
peer the exact CCAAS packets, update the approval of `Host2MSP` and the
GW repeats E2E flows endorsing exclusively through the peer kind.

`helm template` alone is not considered a deployment test. It is kept as static validation prior to the actual installation.

The target onboarding sequence for an autonomous host is:

```text
Host authorization
        ↓
One-time activation bound to the domain and network
        ↓
HostingServiceCredential (VC JSON and VC-JWT)
        ↓
Governed registration with the Fabric ICA
        ↓
MSP and TLS enrollment with host-generated private keys
        ↓
Kubernetes Secrets
        ↓
helm upgrade --install gdc-host
        ↓
Peer + CouchDB + GW CORE + PostgreSQL + IPFS + CCAAS
        ↓
Channel and chaincode reconciliation, write, read and restart
```

The evidence links the verified Host VC to the MSP administrator safeguarded by the entity authorized to administer Fabric, the sanitized public MSP definition, the two-use peer enrollment grant, the independent one-use GW client grant, and the resulting MSP/TLS and client certificates. The certificate evidence records the SHA-256 identifier of the Host VC. It then covers reconciler admission, Kubernetes Secrets, Helm installation, peer and CouchDB startup, the Kubernetes peer joining the external channels, lifecycle of the nine CCAAS packages and GW E2E operations signed as `Host2MSP` through that peer. Docker retains the Fabric ICA, reference orderer and reference peer that represent the external network; the Docker peer does not endorse GW operations during the Kubernetes gate. After restarting GW, the peer and CCAAS runtimes, the test verifies channels, reads, authorization and PostgreSQL/IPFS persistence again.

## Authorities that should not be confused

- The **data space CA** publishes the anchor and signs the Issuer CA.
- **data-space ICA** verifies the authorization and issues the
`HostingServiceCredential` as JSON VC and VC-JWT.
- **Fabric ICA** registers enrollment identities and signs the
MSP/TLS certificates of the peer and the independent client certificate of the GW.

`HostingServiceCredential` authorizes registration, but is not a Fabric certificate. After verification, Fabric DevOps team provisions MSP administrator into the custody of the entity authorized to manage Fabric and exports only the public MSP definition. It also registers a two-use limited enrollment identifier and secret in Fabric ICA for MSP/TLS, plus another one-use identifier for the GW client. The helper adds an operational expiration window and rejects the grant once it expires; Fabric DevOps team revokes any unconsumed identifier because Fabric ICA does not apply that file date on its own. The Node Operator DevOps team executes the enrollment and locally generates the MSP/TLS and GW client private keys; only CSRs leave Node Operator and only signed certificates return directly from Fabric ICA.

For `local-network`, a domain previously configured in the data space ICA can obtain the credential without PDF. The ICA operator creates a one-time activation and the request includes the public JWK and an ES384 signature of the private key that remains on the host. The evidence records the digest of that authorization without inventing PDF, PAdES, provisional DID or IPFS object. In production the same separation is applied with new activation and keys.

## Requirements

- Docker and Docker Compose
- Node.js 22 or later
- OpenSSL and `jq`
- Helm, `kubectl` and `kind`
- adjacent public checkouts of `dataspace-ca-ts` and `dataspace-ica-ts`

The public checkout of `dataspace-ica-ts` also provides the Firestore/GCS migration to PostgreSQL/IPFS. The collector runs its local gate with real Firestore Emulator, PostgreSQL, and Kubo, using exclusively synthetic logs and PDFs. Publishing the code, schematic, fixtures and synthetic reports does not authorize publishing credentials, signed contracts, personal data or keys.

No personal path is needed. If the repositories are not siblings, indicate their paths with `DATASPACE_CA_ROOT` and `DATASPACE_ICA_ROOT`.

## Complete execution

The reproducibility test builds GW CORE from checkout:

```bash
cd "${REPO_ROOT}"
npm ci

release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
image_name="gw-core:${release_tag}"

LOCAL_IMAGE_NAME="${image_name}" ./docker_build_local.sh

IMAGE_NAME="${image_name}" \
DATASPACE_CA_ROOT="${DATASPACE_CA_ROOT}" \
DATASPACE_ICA_ROOT="${DATASPACE_ICA_ROOT}" \
npm run evidence:open-source-production-readiness
```

Among the generated doors there must be:

```text
21-dataspace-ica-postgres-ipfs-migration: PASS
```

This gate requires that all four collections arrive in PostgreSQL, that each audit object has a recoverable CID, that there are no outstanding GCS references, and that the transformed source and target digests match.

To verify or reuse already published artifacts without rebuilding them:

```bash
export GW_PUBLIC_IMAGE="ghcr.io/global-datacare/gw-core@sha256:724ba328915d9907d7254c7eeded845d70dc1ae05881bccff630e871fbc7389f"
export CCAAS_PUBLIC_IMAGE="ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac"
docker buildx imagetools inspect "${GW_PUBLIC_IMAGE}"
docker buildx imagetools inspect "${CCAAS_PUBLIC_IMAGE}"
docker pull "${GW_PUBLIC_IMAGE}"
docker pull "${CCAAS_PUBLIC_IMAGE}"
```

The public output is under `artifacts/open-source-production-readiness/<fecha>/`. Includes statuses per gate, sanitized logs, summary and manifest with hashes. Disposable keys and secrets do not enter public evidence.

## Separate tests during development

```bash
# Docker: complete functional test with PostgreSQL, IPFS and Fabric.
IMAGE_NAME="${image_name}" npm run docker:smoke:open-source-local-network

# Helm: lint, schemas, profiles and immutable images; does not mutate a cluster.
npm run helm:test:host

# Helm: real installation; requires the Docker local-network to be ready.
IMAGE_NAME="${image_name}" npm run helm:smoke:local-network
```

The Helm script creates and deletes its own `kind` cluster and uses the `kind-gdc-host-evidence` context in all commands. It does not use the machine's active Kubernetes context.

## Promotion to test-network and production

The same immutable image and chart are promoted, while each environment supplies different values and secrets. Before installing an independent host, the following must exist:

- formal approval and verified `HostingServiceCredential`;
- Fabric ICA grant limited to two enrollments for peer and grant
independent of a use for the GW client, both within its window;
- MSP, TLS and GW client identity generated locally by Node Operator;
- Kubernetes secrets for GW, peer, CouchDB, PostgreSQL and authorization;
- DNS, TLS, StorageClass, IngressClass and KMS from Node Operator;
- CCAAS images per digest and package IDs calculated for the address
specific service of the release;
- approved reconciliation of MSP, channels and chaincode lifecycle.

Helm does not have registration credentials, does not decide which MSP enters the network, and does not modify channels. Install the authorized runtime. Fabric DevOps team performs privileged pre- and post-installation operations through the reconciler.

| Environment | Chart | Specific configuration |
| --- | --- | --- |
| `local-network` | `gdc-host` | Local Images, Local Authorities, DNS `.localhost`, and Kind StorageClass. |
| `test-network` | The same `gdc-host` | Published digests, staging authorities, DNS/TLS and cloud storage. |
| Production | The same `gdc-host` | VC host and new certificates, approved digests, KMS and Node Operator configuration. |

No MSP, TLS, keys, Secrets, grants or verifiable credentials are reused between environments. The chart, the configuration structure and the versions or digests that have passed the corresponding gates are reused.

## Main files

- `infra/fabric/local-network/`: Reproducible Fabric Docker.
- `charts/gdc-host/`: unique chart for any Node Operator.
- `scripts/enrollment/`: authorization, registration and local enrollment.
- `scripts/governance/`: decision and declarative reconciliation.
- `scripts/onboarding/`: assistant by authority/host/platform roles.
- `scripts/collect-open-source-production-readiness-evidence.sh`: total runner.
- `scripts/smoke-helm-local-network.sh`: installation and E2E Kubernetes.
- `deliverables/GUIDE_HOST_OPERATIONS_EN.md`: detailed procedure by role.
