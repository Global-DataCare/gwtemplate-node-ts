---
name: gw-core-local-image-release
description: Build, validate, publish and deploy one immutable GW CORE Docker image. Use for GW CORE Docker changes, local Fabric image smoke, Artifact Registry publication, GKE rollout, deployment-profile changes, or release verification in gwtemplate-node-ts.
---

# GW CORE local image release

## Mandatory TDD

Use red-green-refactor TDD for every behavior or flow change. Write and run the smallest executable contract test first; it must fail for the intended reason before implementation begins. Then implement the minimum change and make focused, integration and affected end-to-end tests green. Begin every new or modified test suite with a flow-contract comment. Begin every Playwright or other E2E file with the complete numbered journey and its authorization and persistence invariants. Mocks may isolate units but never replace real boundary proof. Never make a test green by accepting an error, placeholder, pending setup or other incomplete terminal state.

Build and test one repository-scoped `linux/amd64` image, publish that exact
image, and deploy only its immutable registry digest. Do not replace the
checked-in scripts with ad-hoc `docker build`, `docker push` or `kubectl set
image` commands.

## Workload identity boundary

Never infer a workload from a historical cloud project, cluster, context or
repository name. This skill deploys GW CORE only. Before any `kubectl`
mutation, select the intended cluster credentials explicitly and verify the
configured namespace, Deployment, Service and public domain against the
target-specific inventory. A currently active context is not evidence of the
target. Participant names, domains, project identifiers and addresses must not
be copied into this reusable skill.

## Read before acting

1. Read the repository `AGENTS.md`.
2. Read [references/gdc-development.md](references/gdc-development.md).
3. Inspect `git status`, `origin/main`, `package.json`, `Dockerfile`,
   `.dockerignore`, `docker_build_local.sh`, `docker_run_local.sh`,
   `cloud_deploy.sh` and the selected runtime/deployment profiles.

## Mandatory gates

- Commit and push intentional changes before building the release image.
- Reusable SDK and utility packages must be exact npm registry releases.
  Reject Git SSH/HTTPS, GitHub archives, workspace/file dependencies and
  vendored tarballs; an image build must never require a developer SSH key.
- Both Docker stages must use `npm ci` against the committed lockfile, never
  recalculate the release graph with `npm install`.
- Tag the local image `<package-version>-<short-commit-sha>`.
- Run `docker_build_local.sh`; its context must be this repository, never the
  workspace root. Sibling source repositories must not enter the image.
- Keep `.env*`, credentials, generated output and chaincode outside the image.
- A clean checkout must nevertheless contain every authored JavaScript
  chaincode runtime imported by `chaincode/*-javascript/index.js`. Those
  `lib/*.js` files are source, not generated output; the release-script test
  must fail before Fabric bootstrap if any imported runtime file is untracked.
- Run `npm run check:identity-chaincode-parity` before the Docker smoke. The
  public `chaincode/*-javascript` sources in GW CORE are canonical for the
  reproducible local-network; the check must not depend on a private sibling
  repository.
- Run `npm run docker:smoke:local-network` against the selected image.
- Run `cloud_deploy.sh` in dry-run mode with the checked-in profiles.
- Publish the already-tested image with `SKIP_BUILD=true`.
- Resolve the pushed tag to a registry digest and deploy that digest.
- Wait for rollout and verify the effective image, `/host/ping`, `/api-docs/`,
  host DID and host JWKS before declaring success.

## Network-mode boundary

Treat the image as environment-neutral:

- image smoke: `NETWORK_MODE=local-network`
- governed integration/staging profiles: `NETWORK_MODE=test-network`
- production: `NETWORK_MODE=network`

These values and their Fabric channels come from the selected runtime profile.
Never bake a profile into the image. Before and after rollout, inspect the
effective `ConfigMap`/`Secret` references and confirm the expected mode.

## Role and provider boundaries

Keep reusable JSDoc, tests, comments, examples and architecture documents
vendor-neutral. Describe the network promoter/governor, hosting provider,
offline dataspace CA operator, dataspace ICA provider, Fabric ICA, participant
organization/tenant, identity provider, persistence provider and KMS provider
by role. Real organization names, domains, project ids and regions belong only
in target-specific deployment profiles, inventories and operational runbooks.

Do not conflate the offline dataspace CA, the dataspace ICA and the Fabric ICA.
The offline dataspace CA publishes the space trust anchor and signs the
dataspace ICA public request without exposing its Root private key. The
dataspace ICA verifies legal onboarding evidence and issues participant VCs.
The Fabric ICA enrolls MSP, peer, orderer and client identities for the governed
ledger network.

## Promotion and persistence gates

Promote in this order:

1. Validate the offline local dataspace trust anchor with `dataspace-ca-ts`,
   including Root/issuer static publication, before claiming governed
   onboarding evidence.
2. Run the GW service locally with the local dataspace ICA, in-memory vault and
   Fabric `local-network`; prove signed evidence verification and participant
   VC consumption.
3. Run provider-focused persistence smokes separately. A Firestore/GCS profile
   validates a cloud-hosted participant runtime; a PostgreSQL/IPFS profile
   validates a portable host-provider runtime. Do not make either profile a
   prerequisite for the basic in-memory local-network smoke.
4. Deploy the same immutable image to Fabric `test-network` with the selected
   staging profile.
5. Deploy by digest to production only after strict token verification,
   encrypted transport, persistent Confidential Storage and KMS bootstrap
   checks pass.

For production, the process-owned runtime KEK must be unwrapped once during
bootstrap through the configured KMS adapter. Firebase token verification,
Firestore vault persistence and GCS object persistence are separate concerns;
PostgreSQL and IPFS are alternative provider choices, not identity services.

The final open-source project evidence has four mandatory, complementary gates:

1. trust control plane: `dataspace-ca-ts` tests plus disposable local
   Root/issuer publication, followed by a local `dataspace-ica-ts` signed
   evidence to participant-VC lifecycle;
2. runtime data plane: `npm run docker:smoke:open-source-local-network`, which
   starts PostgreSQL and IPFS in Docker on the local Fabric network, forces
   confidential JWE blobs out of relational rows, verifies both persistence
   systems contain data, restarts GW with the same local KEK, and proves both
   host and tenant metadata recover.
3. governed host plane: a signed host-form or governed preauthorization to
   mandatory `HostingServiceCredential` contract, the signed
   governance/reconciler contract and a real local dynamic-admission topology.
   Bootstrap channels with `Host1MSP`, admit `Host2MSP` through a signed config
   update, and only then start/join its peer. Name generic Fabric members
   `Host1MSP` and `Host2MSP`;
   never use `Org1MSP`/`Org2MSP` in report evidence because VAT-addressed
   tenant Organizations are hosted application data, not Fabric members.
4. Kubernetes portability plane: validate the complete immutable host chart,
   create an isolated kind cluster, load the already-tested GW image by digest,
   enroll a dedicated peer identity through the Fabric ICA, install
   peer/CouchDB/GW/PostgreSQL/IPFS with Helm, join the Kubernetes peer to the
   local channels, repeat the local-network E2E and prove recovery after
   restarting GW and peer. A render-only `helm template` is not this gate.

Keep the Kubernetes peer proof and application endorsement proof explicit. The
local Helm gate must install and approve the nine exact CCAAS packages on the
kind peer before enabling GW, point GW at that peer, exercise Consent and SMART
through it, and repeat readiness after restarting GW, peer and CCAAS. The
Docker peer is only the external-network gossip/bootstrap route during this
gate and must not be used as GW's endorsement endpoint.

Generate the presentation bundle with
`npm run evidence:open-source-production-readiness`. It must contain only
public CA artifacts, logs, statuses, repository/image identities and hashes.
Never copy private CA keys, Fabric enrollment secrets or the local KEK into the
evidence directory. The audit gate must prove dynamic `Host2MSP` admission to
channels initially bootstrapped with `Host1MSP`; a two-host genesis alone is
not sufficient. Require the Host VC in local, test and production. PDF-free
local preauthorization still emits a VC and never means controller-only Fabric
enrollment. Package only `msp.tgz`, `tls.tgz`, sanitized authorization and
hashes for Helm; the grant and raw VC-JWT stay outside runtime Secrets.
Generate all nine CCAAS packages deterministically from the exact Helm fullname
and namespace. Never copy example package IDs: a Service, release, port or TLS
change requires new archives, hashes, values and governed approvals.

For the report, keep production identity routing explicit: EU VAT
Organizations and organization-scoped employees use `identity-eu`, while
natural-person individuals use `identity-global`.
When one provisional host serves both employee and individual routes for the
same VAT tenant, require two complementary proofs: employee onboarding/DCR and
a live SMART data-access smoke with explicit consent plus an unconsented
employee denial. Sharing a runtime must not collapse `identity-eu` and
`identity-global`.

The ordinary in-memory smoke remains the faster developer gate but is not
sufficient on its own for an open-source reproducibility report.

## Build and smoke

```bash
release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
local_image="gw-core:${release_tag}"

npm run check:identity-chaincode-parity

DOCKER_PLATFORM=linux/amd64 LOCAL_IMAGE_NAME="${local_image}" \
  ./docker_build_local.sh

IMAGE_NAME="${local_image}" npm run docker:smoke:local-network
```

Do not publish after a ping-only smoke. The release gate includes canonical
ConsentAccess and SMART individual/research flows on Fabric local-network.
If the parity guard fails, update and release the canonical CCAAS contract
first, synchronize the GW packaging mirror, and rerun both chaincode suites;
never fix only the mirror to make the smoke green.

Research search fixtures must query claims preserved by the fail-closed
digital-twin projection. Prefer exact token claims such as
`MedicationStatement.code`; do not query `code-text`, `code-display`, `note`,
or other free text removed to prevent re-identification. A successful token
issuance followed by zero results can therefore indicate an impossible smoke
filter rather than missing Composition projections.

## Publish and deploy

Use `.env.gke.gdc` and `demo-deploy.config` after verifying their values:

```bash
GDC_IMAGE_TAG="${release_tag}" DEPLOY_DRY_RUN=true \
  ./cloud_deploy.sh gke gdc demo-deploy.config

GDC_IMAGE_TAG="${release_tag}" SKIP_BUILD=true \
LOCAL_IMAGE_NAME="${local_image}" DEPLOY_CONFIRM=true \
  ./cloud_deploy.sh gke gdc demo-deploy.config
```

Use task-isolated GCloud and kube configurations. Record the local image ID,
registry digest, commit, target tuple, effective network mode, rollout and
endpoint results. A build or push alone is not a deployment.

## Controller and commercial Order regression gate

- Treat `Offer -> Order/_batch -> seat inventory -> Employee/_batch` as one
  shared GW contract; payment providers such as Stripe are deployment adapters,
  not product-specific licence semantics.
- After DCR, verify controller `iss + kid` against the stored tenant key.
  A JWT-header or DIDComm-plain public JWK is optional compatibility data.
- Keep professional `Order/_batch` routed through `host`, while resolving
  its sender keys from the issuer tenant.
- The targeted integration test must use a historical host catalog that does
  not advertise `Order`; advertising it in the fixture hides the real 404.
