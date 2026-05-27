# Kubernetes Manifests (Templates)

These are minimal templates meant to be adapted per cluster and environment.
They are intentionally incomplete and include placeholders for secrets, hostnames,
storage classes, and TLS material.

Typical flow:
1) Create namespaces (`test-fabric-v3`, `prod-fabric-v3`, `test-gdc-v1`, `prod-gdc-v1`).
2) Create secrets for MSP and TLS material.
3) Deploy Fabric CA, orderer, peers, and optional CouchDB.
4) Deploy GW host/connector separately in `*-gdc-v1`.
5) If you also run `dataspace-ica-ts`, keep it separate from both Fabric and GW even if it shares the same GCP project.

## GW host/connector on GKE

The GW deployment skeleton now lives under `fabric-multicloud/k8s/gdc/`.

It assumes:
- separate namespace such as `test-gdc-v1`
- separate secret/config from Fabric
- `ICA_URL_EXTERNAL` is optional and points to a public `dataspace-ica-ts` endpoint only if that integration is enabled
- Workload Identity or equivalent GCP auth for Firestore/GCS
- reserved static IP + `LoadBalancer` Service for the current IP-only demo path

Apply it with:

```bash
source demo-deploy.config
bash fabric-multicloud/scripts/05-k8s-deploy-gdc.sh
```

Before applying, create `gwtemplate-secret` from the template in `fabric-multicloud/k8s/gdc/secret.template.yaml`.

## Fabric v3.1.3 channel artifacts (local toolchain)

Local generation is the recommended path for the demo and for IT teams that want to reproduce
the network setup outside of GKE. It avoids relying on a `fabric-tools` image (which is still
2.5.x) and ensures `configtxgen` matches the Fabric runtime version.

### Initial capabilities for new networks (recommended)

Even with Fabric v3.1.3 binaries, start channels at:
- **Channel**: `V2_0` (or `V2_5` if your orderer build supports it)
- **Application**: `V2_0` (or `V2_5` if supported)
- **Orderer**: `V2_0`

This is a supported and common posture. The upstream sampleconfig in Fabric `main` shows
`Channel: V3_0`, `Application: V2_5`, `Orderer: V2_0`, but that is **not a requirement**
for a brand‑new network. It is safe to start at `V2_0` (or `V2_5`) and move to `V3_0` later
once all orderers/peers are confirmed on v3 and you have org‑level `OrdererEndpoints` in place.

If your orderer build rejects `V2_5` capabilities, fall back to `V2_0` for the initial config.

### 1) Generate channel blocks locally (v3.1.3)

```bash
./scripts/generate-channel-blocks-local.sh
```

This script:
- downloads the Fabric v3.1.3 binaries into `tools/` (ignored by git)
- creates a temporary MSP with the correct root/intermediate CA chain
- generates all `.block` files into `artifacts/test/channel-artifacts/`

If blocks already exist, it will prompt before overwriting. Set `GDC_FORCE=1` to skip the prompt.
To override platform detection, set `FABRIC_PLATFORM` (examples: `darwin-amd64`, `darwin-arm64`, `linux-amd64`).

### 2) Prepare admin client chain for osnadmin

```bash
cat artifacts/test/enroll/osnadmin-tls/tls/signcerts/cert.pem \
    artifacts/test/fabric-ca-server-ica/TAXES-G02793479_TEST-EUR-ICA_UNID_ONLINE/ca-cert.pem \
    > /tmp/osnadmin-client-chain.pem
```

### 3) Join the orderer to channels (via Admin endpoint)

Use the in‑cluster Job (reproducible, no port‑forward):

```bash
kubectl -n test-fabric-v3 create configmap channel-blocks \
  --from-file=artifacts/test/channel-artifacts \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n test-fabric-v3 create secret generic osnadmin-tls \
  --from-file=client-chain.pem=/tmp/osnadmin-client-chain.pem \
  --from-file=client.key=$(ls artifacts/test/enroll/osnadmin-tls/tls/keystore/*_sk | head -n 1) \
  --from-file=ica-ca.pem=artifacts/test/fabric-ca-server-ica/TAXES-G02793479_TEST-EUR-ICA_UNID_ONLINE/ca-cert.pem \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n test-fabric-v3 delete job osnadmin-join --ignore-not-found
kubectl apply -f fabric-multicloud/k8s/osnadmin-join-job.yaml
kubectl -n test-fabric-v3 logs job/osnadmin-join -f
```

### 3b) List channels (verification)

```bash
kubectl -n test-fabric-v3 delete job osnadmin-list --ignore-not-found
kubectl apply -f fabric-multicloud/k8s/osnadmin-list-job.yaml
kubectl -n test-fabric-v3 logs job/osnadmin-list -f
```

### 4) Join peer to channels (reproducible job)

```bash
kubectl -n test-fabric-v3 delete job peer-join --ignore-not-found
kubectl apply -f fabric-multicloud/k8s/peer-join-job.yaml
kubectl -n test-fabric-v3 logs job/peer-join -f
```

### 5) One-shot: join orderer + list + join peer

```bash
source private-deploy.config
bash fabric-multicloud/scripts/07-join-channels.sh
```

### 6) Anchor peers (set on all channels)

```bash
kubectl -n test-fabric-v3 delete job anchor-peers --ignore-not-found
kubectl apply -f fabric-multicloud/k8s/anchor-peers-job.yaml
kubectl -n test-fabric-v3 logs job/anchor-peers -f
```

### 7) Chaincode example (organization-sc on identity-organization)

```bash
kubectl -n test-fabric-v3 create configmap organization-sc \
  --from-file=chaincode/organization-sc-javascript \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n test-fabric-v3 delete job chaincode-deploy --ignore-not-found
kubectl apply -f fabric-multicloud/k8s/chaincode-deploy-job.yaml
kubectl -n test-fabric-v3 logs job/chaincode-deploy -f
```

### 4) Key notes for Fabric v3.x

- For **Channel/Application V2_5**, use global `Orderer.Addresses` and **do not** set `OrdererEndpoints`.
- For **Channel V3_0**, you must move to org‑level `OrdererEndpoints` and remove `Orderer.Addresses`.
- `configtxgen` must be v3.x to emit blocks for `V3_0` capabilities.
- If NodeOUs are not enabled, `admincerts` must exist in the MSP for channel creation.

### 8) Upgrading channels to V3_0 later (outline)

1. Export and decode the current channel config.
2. Update capabilities (`Channel`, `Application` to `V3_0`) and ensure `OrdererEndpoints` are set per org.
3. Compute config update, collect signatures, submit with `peer channel update`.

We will script this once the test network is stable.

### Evidence template (W3C VC 2.0, Gaia‑X, PDF signature)

For organization onboarding, the VC payload should include an `evidence` entry that proves
adhesion to the Terms & Conditions. The PDF can be public; store **hashes + signature** on‑chain,
not the PDF itself.

Minimum evidence fields (JSON‑LD):

```json
{
  "evidence": [
    {
      "type": "DocumentSignature",
      "documentUrl": "https://unid.online/terms/uhc-terms-v1.pdf",
      "documentVersion": "v1",
      "digest": [
        {
          "type": "DocumentHash",
          "hashAlg": "sha256",
          "hashValue": "<hash-of-PDF-without-signature>"
        },
        {
          "type": "SignedDocumentHash",
          "hashAlg": "sha256",
          "hashValue": "<hash-of-signed-PDF>"
        }
      ],
      "signature": {
        "type": "PAdES",
        "signatureValue": "<base64url-encoded-signature-bytes>",
        "signingCertSerial": "<serial>",
        "signingCertSubject": "<subject>",
        "signingTime": "2026-02-03T12:00:00Z"
      },
      "verifier": "did:web:unid.online",
      "verifiedAt": "2026-02-03T12:05:00Z"
    }
  ]
}
```

Notes:
- Use **base64url** for `signatureValue`.
- If you follow OIDC4IDA evidence, embed it as an additional `evidence` entry (type `OIDC4IDA`).
- The schema URL for the VC should be the **central governance URL** (UNID).

### Troubleshooting (known issues & fixes)

- **`x509: certificate signed by unknown authority` when joining channels**
  - Root cause: the consenter TLS cert is signed by the ICA, but `ORDERER_GENERAL_TLS_ROOTCAS` only contained the root CA.
  - Fix: append `/var/hyperledger/orderer/msp/intermediatecerts/*.pem` to `/var/hyperledger/orderer/tls/ca.crt` (done in `fabric-multicloud/k8s/orderer.yaml` initContainer).
- **`tls: failed to verify certificate ... not localhost` with osnadmin**
  - Root cause: port‑forward to `localhost` does not match the cert SAN.
  - Fix: run osnadmin **inside the cluster** and target `orderer:9443` (jobs above).
- **`osnadmin: cannot execute binary file`**
  - Root cause: wrong OS/arch binary (Linux binary on macOS).
  - Fix: use the in‑cluster job or ensure local `FABRIC_PLATFORM=darwin-amd64`.
- **Orderer/peer CrashLoop: missing MSP dirs**
  - Root cause: MSP secrets created from directories (flattened structure).
  - Fix: use `msp.tgz` / `tls.tgz` (handled in `fabric-multicloud/scripts/03-k8s-create-secrets.sh`).
