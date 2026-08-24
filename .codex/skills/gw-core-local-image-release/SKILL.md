---
name: gw-core-local-image-release
description: Build, validate, publish and deploy one immutable GW CORE Docker image. Use for GW CORE Docker changes, local Fabric image smoke, Artifact Registry publication, GKE rollout, deployment-profile changes, or release verification in gwtemplate-node-ts.
---

# GW CORE local image release

Build and test one repository-scoped `linux/amd64` image, publish that exact
image, and deploy only its immutable registry digest. Do not replace the
checked-in scripts with ad-hoc `docker build`, `docker push` or `kubectl set
image` commands.

## Read before acting

1. Read the repository `AGENTS.md`.
2. Read [references/gdc-staging.md](references/gdc-staging.md).
3. Inspect `git status`, `origin/main`, `package.json`, `Dockerfile`,
   `.dockerignore`, `docker_build_local.sh`, `docker_run_local.sh`,
   `cloud_deploy.sh` and the selected runtime/deployment profiles.

## Mandatory gates

- Commit and push intentional changes before building the release image.
- Tag the local image `<package-version>-<short-commit-sha>`.
- Run `docker_build_local.sh`; its context must be this repository, never the
  workspace root. Sibling source repositories must not enter the image.
- Keep `.env*`, credentials, generated output and chaincode outside the image.
- Run `npm run check:identity-chaincode-parity` before the Docker smoke. Shared
  identity chaincodes are canonical in sibling `fabric-multicloud`; the GW
  `chaincode/*-javascript` copies are temporary local-network packaging mirrors
  and must be byte-equivalent apart from generated dependency/coverage output.
- Run `npm run docker:smoke:local-network` against the selected image.
- Run `cloud_deploy.sh` in dry-run mode with the checked-in profiles.
- Publish the already-tested image with `SKIP_BUILD=true`.
- Resolve the pushed tag to a registry digest and deploy that digest.
- Wait for rollout and verify the effective image, `/host/ping`, `/api-docs/`,
  host DID and host JWKS before declaring success.

## Network-mode boundary

Treat the image as environment-neutral:

- image smoke: `NETWORK_MODE=local-network`
- governed staging: `NETWORK_MODE=test-network`
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

The final open-source project evidence has three mandatory, complementary gates:

1. trust control plane: `dataspace-ca-ts` tests plus disposable local
   Root/issuer publication, followed by a local `dataspace-ica-ts` signed
   evidence to participant-VC lifecycle;
2. runtime data plane: `npm run docker:smoke:open-source-local-network`, which
   starts PostgreSQL and IPFS in Docker on the local Fabric network, forces
   confidential JWE blobs out of relational rows, verifies both persistence
   systems contain data, restarts GW with the same local KEK, and proves both
   host and tenant metadata recover.
3. governed host plane: a signed host-form to `HostingServiceCredential`
   contract, the signed governance/reconciler contract and a real local
   two-peer topology. Name generic Fabric members `Host1MSP` and `Host2MSP`;
   never use `Org1MSP`/`Org2MSP` in report evidence because VAT-addressed
   tenant Organizations are hosted application data, not Fabric members.

Generate the presentation bundle with
`npm run evidence:open-source-production-readiness`. It must contain only
public CA artifacts, logs, statuses, repository/image identities and hashes.
Never copy private CA keys, Fabric enrollment secrets or the local KEK into the
evidence directory. State explicitly that a two-host genesis/bootstrap proves
multi-host topology but does not prove dynamic admission to an already-running
channel; the real operator mutation driver needs a live E2E before production.

For the human-only GDC report, keep production identity routing explicit:
EU VAT Organizations and organization-scoped employees use `identity-eu`,
while natural-person individuals use `identity-global`. Animal identity,
veterinary services and `animal-*` channels are outside this evidence scope.
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
