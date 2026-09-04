# Auditable host operations guide

This guide is public, neutral with respect to Node Operator and valid for `local-network`, `test-network` and `network`. Domains, endpoints, values, credentials, and real names are kept in a private inventory. Secrets are never copied to this repository or to Helm output.

For real operation, follow the short guide first [`MIGRATION_AND_DEPLOYMENT_ICA_EN.md`](./MIGRATION_AND_DEPLOYMENT_ICA_EN.md) and then [`PROCEDURE_HOST_ONBOARDING_EN.md`](./PROCEDURE_HOST_ONBOARDING_EN.md). This document preserves the technical reference detail and does not replace that order.

## 1. Result and roles

Successful execution produces a `HostingServiceCredential` VC-JWT, an authorization linked to the URL/MSP/network/channels, an MSP administrator safeguarded by the entity authorized to administer Fabric, MSP and TLS certificates with host-generated private keys, the MSP admitted to the channels, the runtime installed through Helm, and evidence of write, read, denial and persistence.

| Role | Responsibility | Delivery |
| --- | --- | --- |
| Governance Committee | Approves the applicable procedure and agreements on channels | approved procedure and agreements |
| Responsible for technical validation | Valid in accordance with section 10.4 of the Rulebook: the Data Space Operator when designated or, failing that, the host Node Operator and the corresponding ICA | validation result |
| data-space ICA | Verifies evidence or pre-authorization and issues the Host VC | `host-credential.jwt` and public DID of the ICA |
| Node Operator | Provide the legal data and the domain that must be authorized | approved legal identity and domain |
| Node Operator DevOps team | Generate keys, request MSP/TLS certificates, create Secrets and operate GW CORE, the peer and Helm | private identity, release and operational evidence |
| Entity authorized to administer Fabric | Custody the Fabric ICA registrar identity and `<MSP>.admin` | MSP public definition and administrative custody |
| Fabric DevOps team | Verify the Host VC, register the grants and execute the agreed channel changes | `authorization.json`, grants, TLS chain and reconciler auditing |

The data-space ICA and the Fabric ICA are different services. The Host VC does not replace Fabric X.509 certificates. This guide uses **Node Operator, acting as a Hosting Provider for organizations that provide or consume index or digital-twin services**, as defined in the Rulebook: the accredited technical infrastructure that hosts participants and provides services in the Data Space. The **Node Operator DevOps team** executes the deployment and operation commands and never receives the Fabric ICA registrar identity.

The **Fabric ICA registrar identity** and the **MSP administrator** are different identities. Both are **Fabric administrative identities**. The first registers enrollment identifiers in the Fabric ICA; the second administers the MSP during authorized configuration and lifecycle operations. The **entity authorized to administer Fabric** safeguards both identities, and the **Fabric DevOps team** uses them to execute approved operations. The Node Operator DevOps team receives neither identity: it receives only temporary enrollment grants.

A temporary enrollment grant is not a certificate. It contains the temporary enrollment ID and secret needed to request a certificate from the Fabric ICA. When the grant is consumed, the private key is generated inside the Node Operator infrastructure and the Fabric ICA returns the X.509 certificate. The peer grant permits the MSP and TLS enrollments; the GW client grant permits its MSP enrollment. A grant does not add the peer to any channel. The Fabric ICA returns the certificates directly to the Node Operator. They do not pass through the Fabric DevOps team.

In accordance with section 10.4 of the Rulebook, the Node Operator must demonstrate technical capability, identity and trust mechanisms, artifact publication and Compute-to-Data controls where applicable. Its authorization requires validation by the Data Space Operator when designated or, otherwise, by the hosting Node Operator and the corresponding ICA. Rulebook section 13.3 assigns it contractual and regulatory obligations concerning security, infrastructure availability and data protection.

## 2. Requirements

- Node.js 22+, Docker/Compose, `jq`, OpenSSL and Git.
- Helm 3, `kubectl` and cluster access; `kind` for local testing only.
- `fabric-ca-client` for the host role.
- OCI registry accessible by the cluster and images pinned by `@sha256` outside
of premises.
- peer connectivity to orderer, bootstrap peers and CCAAS Services.

```bash
export REPO_ROOT="$(pwd)"
cd "${REPO_ROOT}"
npm ci
git status --short
```

## 3. Complete reproducible validation on local-network

Declare public checkout routes; do not encode them in documents:

```bash
export DATASPACE_CA_ROOT="/path/to/checkout/dataspace-ca-ts"
export DATASPACE_ICA_ROOT="/path/to/checkout/dataspace-ica-ts"
release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
export IMAGE_NAME="gw-core:${release_tag}"

LOCAL_IMAGE_NAME="${IMAGE_NAME}" ./docker_build_local.sh
npm run evidence:open-source-production-readiness
```

The computer running the validation keeps the directory advertised under `artifacts/open-source-production-readiness/`, verifies that all files in `gates/` contain `PASS`, and verifies the hashes. The collector tests disposable CAs and ICA, Fabric Docker with `Host1MSP`/`Host2MSP`, PostgreSQL/IPFS, and a kind cluster where Helm installs peer, CouchDB, GW, and nine CCAAS. Runs Consent/SMART, negative checks and resets.

The same collector runs the ICA public migration gate from Firestore/GCS to PostgreSQL/IPFS. Only use synthetic fixtures; signed PDFs, credentials and actual keys remain outside the repository and public evidence.

Separate doors:

```bash
IMAGE_NAME="${IMAGE_NAME}" npm run docker:smoke:open-source-local-network
npm run helm:test:host
IMAGE_NAME="${IMAGE_NAME}" npm run helm:smoke:local-network
```

## 4. Private inventory for test-network or production

```bash
install -d -m 700 /secure/onboarding /secure/inventory /secure/host
cp configs/host-onboarding.production.example.json /secure/onboarding/onboarding.json
cp charts/gdc-host/ci/production-values.yaml /secure/inventory/host.values.yaml
chmod 600 /secure/onboarding/onboarding.json /secure/inventory/host.values.yaml
```

In `test-network`, change to `environment: staging`, `networkMode: test-network` and ICAs/staging credentials. In production use `environment: production`, `networkMode: network` and new credentials. Never copy MSP, TLS, VC, grant, Secret or KEK between environments.

The inventory defines the URL, `mspId`, orderer, bootstrap peers, channels, namespace, release, StorageClass, IngressClass, DNS/TLS, OCI digests, CCAAS package IDs, KMS adapter, backups, observability, NetworkPolicies and ports. The `mspId` is assigned under the approved procedure. The Node Operator DevOps team copies it exactly and does not choose it unilaterally. Multiple peers under the same Node Operator and administrative scope may reuse one MSP.

`authority.caName` sets the exact name of the broadcaster Fabric ICA. The wizard incorporates it into the grants and `fabric-ca-client` applies it to both registration and MSP, TLS and GW client enrollments.

The MSP assigned according to the approved procedure is the only value that can appear in the request, certificates, and Helm.

The values also set `host.adminEmail`, `host.adminUid` and `host.adminRole`, which identify the initial controller of the reserved technical `host` record. The GW generates its operational keys through KMS and publishes the root DID at `/.well-known/did.json`.

## 5. Activation and HostingServiceCredential

Domain and network pre-authorization is not a substitute for proof of key possession. The ICA operator creates a one-time activation from the pod that shares the ICA database:

```bash
export HOST_HANDOFF_DIR="${HOME}/gdc-host-handoff"
install -d -m 700 "${HOST_HANDOFF_DIR}"

cp configs/host-activation-approval.example.json \
  "${HOST_HANDOFF_DIR}/approved-host.json"
chmod 600 "${HOST_HANDOFF_DIR}/approved-host.json"

kubectl --context '<contexto>' --namespace '<namespace-ica>' \
  exec -i deployment/<deployment-ica> -- \
  node ./bin/ica-cli.js host:activation:create \
    --approval-stdin \
    --expires-in 72h \
    --created-by '<stable-ica-operator-id>' \
  < "${HOST_HANDOFF_DIR}/approved-host.json" \
  > "${HOST_HANDOFF_DIR}/host-activation.json"

chmod 600 "${HOST_HANDOFF_DIR}/host-activation.json"
```

The private copy of `approved-host.json` contains the already approved domain, URL, network, jurisdiction, context, legal identity and controller data. `<` sends them via standard input without copying them to the pod's disk. `>` belongs to the shell that runs `kubectl`: the activation file remains on the ICA operator's computer, not in the pod. The database retains the hash, approved data, expiration, and state, but never the original code. The operator of ICA delivers the encrypted file to Node Operator DevOps team; the wizard rejects any changes to the approval, generates the key locally, and executes the request. This carries the public JWK, `kid` and JWS; `thid` only queries asynchronous work. ICA consumes activation and issues Host VC without PDF.

## 6. Phase A: Fabric DevOps team and Fabric ICA

### 6.1 Controlled opening and testing by the DevOps team

The Fabric ICA does not participate in normal gossip, endorsement, channel or consensus traffic. It is required for initial enrollment, renewal, revocation and host onboarding. Its public LoadBalancer may therefore be restricted to the Node Operator's fixed egress IP and closed after enrollment.

Fabric DevOps team preserves the procedure to open, restrict and close that window in its private repository. Only the HTTPS URL, CA name, and public string are given to Node Operator DevOps team. Before consuming any grants check:

```bash
export FABRIC_CA_URL='https://fabric-ica.example.org:443'
export FABRIC_CA_NAME='ca-ica'
export FABRIC_CA_TLS_CERTFILES=/secure/trust/fabric-ica-ca-chain.pem

fabric-ca-client getcainfo \
  -u "${FABRIC_CA_URL}" \
  --caname "${FABRIC_CA_NAME}" \
  --tls.certfiles "${FABRIC_CA_TLS_CERTFILES}"
```

Fabric ICA registrar identity is never delivered to the Node Operator DevOps team. The Fabric DevOps team records the identifiers and bounded secrets; the DevOps team consumes them to generate their private keys and certificates on their own infrastructure.

The Fabric DevOps team receives the URL, requested MSP and Host VC-JWT through a secure channel. It gathers the signed approval, signer DID, issuing ICA DID, signer JWKS and Fabric inventory under controlled custody. A pre-existing public DID for the new host is not required. First review the plan:

```bash
request_id="$(jq -r '.governanceDecision.decision.requestId' \
  /secure/approvals/host-enrollment-request.json)"

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority
```

After reviewing the URL, MSP, network, digest, issuer and subject of the Host VC:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role authority \
  --apply --confirm-request "${request_id}"
```

`authorization.json` does not contain the VC-JWT. Before creating the grants, the wizard registers and enrolls the MSP administrator under the private routes held by the entity authorized to administer Fabric:

```text
authority.mspAdminOutputDir   <MSP>.admin key and certificate; never handed off
authority.publicMspOutputDir  sanitized public definition used to admit the MSP
```

The public definition of the MSP is produced by Fabric DevOps team; Node Operator DevOps team does not define it or provide an administrative key. The auditable script that implements this limit is `scripts/enrollment/provision-governed-msp-admin.sh`. A subsequent onboarding of the same MSP reuses that managed identity if the MSP, network, and ICA match; The administrator is never rotated or overwritten as a side effect of registering another peer.

The wizard then creates two private grants in `0600` mode: one supports exactly two enrollments—MSP and TLS of the peer—and another supports a single enrollment for the GW client identity. Both contain `issuedAt`/`expiresAt`. The date is a window applied by these helpers; Fabric ICA applies its usage limits. Fabric DevOps team revokes any handles that are not consumed within the window.

## 7. Phase B: Node Operator DevOps team

An encrypted private packet with this minimum and sufficient content is transferred over a secure channel:

```text
peer-enrollment-grant.json
gw-client-enrollment-grant.json
fabric-ica-ca-chain.pem
fabric-endpoints.json
authorization.json
host-apply-confirmation.json
onboarding.host.json
manifest.sha256
```

The two grants are temporary secrets. The TLS chain and endpoints are public. `authorization.json` is the sanitized authorization result, and `host-apply-confirmation.json` contains the exact `requestId` required by the apply guard. `onboarding.host.json` references those files and the host's private output paths. The Node Operator DevOps team verifies `manifest.sha256` before consuming anything. The Host VC-JWT, PDF, complete network inventory, `<MSP>.admin` identity and Fabric ICA registrar identity are not included in the handoff.

The Node Operator DevOps team generates only the peer/TLS and GW client identities required by its runtime. It executes the plan and apply phases:

```bash
cd /secure/onboarding
shasum -a 256 -c manifest.sha256
request_id="$(jq -r '.governanceDecision.decision.requestId' \
  host-apply-confirmation.json)"

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.host.json --role host

node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.host.json --role host \
  --apply --confirm-request "${request_id}"
```

The assistant invokes public enrollment contracts. If you run the step procedure for an audit, the entry points are:

```bash
ENROLLMENT_GRANT_FILE=/secure/grants/peer-grant.json \
HOST_MSP_OUTPUT_DIR=/secure/host/fabric-peer \
HOST_PEER_DNS="${HOST_PEER_DNS}" \
CA_TLS_CERT=/secure/trust/fabric-ica-ca-chain.pem \
  bash scripts/enrollment/enroll-host-msp.sh

ENROLLMENT_GRANT_FILE=/secure/grants/gw-client-grant.json \
HOST_CLIENT_OUTPUT_DIR=/secure/host/fabric-gw-client \
CA_TLS_CERT=/secure/trust/fabric-ica-ca-chain.pem \
  bash scripts/enrollment/enroll-host-client.sh
```

The first generates MSP and TLS of the peer under the host's private route; the second generates a different client identity for GW CORE. Its variables and routes are materialized from the private manifest and grants, they are not written to the chart or a ConfigMap.

`fabric-ca-client` generates within the host the MSP/TLS keys of the peer and the key of an independent GW client identity; it only sends CSRs and receives certificates. The wizard also produces `/secure/host/gw.fabric.env`, private and in mode `0600`, with `LEDGER_FABRIC_MSP_ID`, peer endpoint/TLS and client certificate/key. No grants appear in that file. Package `/secure/host/helm-runtime` contains only:

Fabric certificates include `gdc.hostCredentialSha256`, the SHA-256 hexadecimal full identifier of the Host VC. The digest is used because the `:ecert` Fabric CA syntax does not support the `:` of a `urn:uuid`; the full identifier remains at `authorization.json`.

```text
msp.tgz
tls.tgz
authorization.json
manifest.sha256
```

The grant, Host VC-JWT and any PDF are excluded. Verify:

```bash
cd /secure/host/helm-runtime
shasum -a 256 -c manifest.sha256
```

## 8. OCI images and CCAAS package IDs

GW CORE is not published on npm. The verified version is available on the [GW CORE package public page](https://github.com/orgs/Global-DataCare/packages/container/package/gw-core). The common runtime for all nine chaincodes is available on the [CCAAS package public page](https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime).

GW CORE and CCAAS are different OCI artifacts. Always use the approved digests:

```bash
export GW_PUBLIC_IMAGE="ghcr.io/global-datacare/gw-core@sha256:724ba328915d9907d7254c7eeded845d70dc1ae05881bccff630e871fbc7389f"
export CCAAS_PUBLIC_IMAGE="ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac"
docker buildx imagetools inspect "${GW_PUBLIC_IMAGE}"
docker buildx imagetools inspect "${CCAAS_PUBLIC_IMAGE}"
docker pull "${GW_PUBLIC_IMAGE}"
docker pull "${CCAAS_PUBLIC_IMAGE}"
```

The GW values use `GW_PUBLIC_IMAGE`. Each CCAAS entry uses the same `CCAAS_PUBLIC_IMAGE` but requires its own `ccaas` package; `connection.json.address` must name the exact Service for the release. The package ID is `<label>:<sha256-of-tgz>`. A change to the release, full name, Service, port or TLS configuration requires regeneration.

Build the nine packages and values fragment after setting the fully qualified name that Helm will use for the Services:

```bash
HOST_FULLNAME="${HELM_RELEASE}" \
KUBE_NAMESPACE="${KUBE_NAMESPACE}" \
CCAAS_IMAGE="${CCAAS_PUBLIC_IMAGE}" \
CCAAS_OUTPUT_DIR=/secure/onboarding/ccaas \
  bash scripts/onboarding/prepare-ccaas-packages.sh

shasum -a 256 -c /secure/onboarding/ccaas/manifest.sha256
```

The result lists the nine package IDs in `manifest.tsv` and produces `chaincodes.values.yaml`. For the default profile, organizations and employees use `identity-eu`, people `identity-global`, and consent agreement `health-care-eu`; any changes must come from the governed inventory, not Node Operator DevOps team.

The values also declare every Fabric channel approved for the peer. Do not confuse this list with `host.allowedSectors`:

```yaml
peer:
  channels:
    - identity-global
    - identity-eu
    - health-care-eu
    - animal-pet-eu
```

`peer.channels` is projected as `HLF_BOOTSTRAP_CHANNELS`. The chart validates the configuration, but the effective union of each channel corresponds to the reconciler executed by Fabric DevOps team.

## 9. Secrets and Helm installation

Start from the generated Fabric file and add only the private configuration of the deployment in a copy held by the host:

```bash
cp /secure/host/gw.fabric.env /secure/host/gw.env
chmod 600 /secure/host/gw.env
# Add KMS, provider and other required variables through the secret manager.
```

Prepare private files for PostgreSQL (`POSTGRES_USER`, `POSTGRES_PASSWORD`), CouchDB (`username`, `password`) and GW (the above file, KMS configuration and provider credentials). If Redis is enabled, also prepare `REDIS_PASSWORD`:

```bash
export KUBE_CONTEXT="contexto-del-cluster"
export KUBE_NAMESPACE="namespace-del-host"
export HELM_RELEASE="nombre-del-host"

kubectl --context "${KUBE_CONTEXT}" create namespace "${KUBE_NAMESPACE}"

HOST_RUNTIME_DIR=/secure/host/helm-runtime \
POSTGRES_SECRET_ENV_FILE=/secure/host/postgresql.env \
COUCHDB_SECRET_ENV_FILE=/secure/host/couchdb.env \
GW_SECRET_ENV_FILE=/secure/host/gw.env \
REDIS_SECRET_ENV_FILE=/secure/host/redis.env \
  bash scripts/onboarding/materialize-kubernetes-secrets.sh
```

`<release>-peer-msp`, `<release>-peer-tls`, `<release>-authorization`, `<release>-postgresql`, `<release>-couchdb`, `<release>-gw` and, when enabled, `<release>-redis` are created. The values must reference them exactly.

```bash
bash scripts/validate-host-helm-values.sh \
  /secure/inventory/host.values.yaml "${KUBE_NAMESPACE}" "${HELM_RELEASE}"

helm template "${HELM_RELEASE}" charts/gdc-host \
  --namespace "${KUBE_NAMESPACE}" \
  --values /secure/inventory/host.values.yaml > /secure/onboarding/rendered.yaml

helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.2
tar -xzf gdc-host-0.3.2.tgz -C /secure/onboarding

helm upgrade --install "${HELM_RELEASE}" /secure/onboarding/gdc-host \
  --kube-context "${KUBE_CONTEXT}" --namespace "${KUBE_NAMESPACE}" \
  --values /secure/inventory/host.values.yaml \
  --atomic --wait --timeout 15m
```

Do not install if the render contains Secrets, VC-JWT, PDF, keys or undigested images. In production each pod unwraps the runtime KEK once using the KMS adapter; `KEK_SECRET` is only valid on local/demo.

## 10. Authorized Fabric operation

The Fabric DevOps team check first:

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform
```

The `commandMap` private Fabric DevOps team defines actual `inspect`/`apply` commands to support the MSP, apply grants, check peer, join channels, install/approve package IDs, and commit definitions through the MSP governor. It never comes from the host's request. With the revised map:

The local test does not use a mock: it runs `scripts/governance/drivers/local-fabric-admission.mjs` against live Fabric. The external `commandMap` only replaces routes, endpoints, and credentials with those of the operator without changing the signed plan or convergence order.

```bash
node scripts/onboarding/host-onboarding-assistant.mjs \
  --manifest /secure/onboarding/onboarding.json --role platform \
  --apply --confirm-request "${request_id}"
```

The reconciler re-inspects each step, is idempotent, preserves state, and writes JSONL auditing. If an actual command is missing, it fails closed; A mock is not valid as an external acceptance test.

## 11. Acceptance

```bash
kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" get pods,pvc,svc
kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" rollout status \
  statefulset/"${HELM_RELEASE}"-peer --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" rollout status \
  deployment/"${HELM_RELEASE}"-gw --timeout=5m
```

Acceptance demonstrates: expected MSP/TLS; only approved channels; correct package IDs, approvals and definitions; write/read through own peer; permission and denial; PostgreSQL/IPFS persistence after GW, peer and CCAAS restart; and restoration according to Node Operator policy. A booted pod is not enough.

Keep as evidence commit, OCI digest, chart, sanitized values, versions, gates, sanitized logs, audit and hash manifest. Do not include grants, VC-JWT, PDFs, keys, private envs, tokens, internal IPs or dumps. Local testing demonstrates software reproducibility; it does not claim that a particular external infrastructure is already deployed.
