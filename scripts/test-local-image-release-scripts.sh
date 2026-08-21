#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash -n ./docker_build_local.sh ./docker_run_local.sh ./cloud_deploy.sh ./scripts/smoke-docker-local-network.sh

grep -qx 'node_modules' .dockerignore
grep -qx 'build' .dockerignore
grep -qx '.git' .dockerignore
grep -qx '.env\*' .dockerignore
grep -qx 'chaincode' .dockerignore
grep -Fq 'Context: ${SCRIPT_DIR}' ./docker_build_local.sh
grep -Fq '"$SCRIPT_DIR"' ./docker_build_local.sh
grep -Fq '"$SCRIPT_DIR"' ./cloud_deploy.sh
grep -Fq 'resolve_pushed_digest' ./cloud_deploy.sh
grep -Fq 'DEPLOY_DRY_RUN' ./cloud_deploy.sh
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER="$HOST_LEGACY_REPRESENTATIVE_CONTROLLER"' ./cloud_deploy.sh
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER=false' ./env.example
grep -Fq 'ALLOWED_SECTORS is required for every gateway deployment' ./cloud_deploy.sh
grep -Fq 'ALLOWED_SECTORS=health-research,health-care,health-index,onehealth-research' ./env.example
grep -Fq 'LOCAL_IMAGE_NAME="${LOCAL_IMAGE_NAME:-gwtemplate}"' ./demo-deploy.config.example

while IFS= read -r env_example; do
  if grep -q '^MAINSECTOR=' "$env_example" \
    && ! grep -q '^ALLOWED_SECTORS=.*onehealth-research' "$env_example"; then
    echo "ERROR: ${env_example} must declare canonical ALLOWED_SECTORS with onehealth-research." >&2
    exit 1
  fi
done < <(git ls-files 'env*.example')
bash ./scripts/smoke-docker-local-network.sh --help | grep -q 'Fabric local-network'
node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q -- '--prepare-only'
grep -Fq 'FABRIC_PEER_ENDPOINT_VALUE="${FABRIC_PEER_ENDPOINT_VALUE:-localhost:7051}"' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'org.schema.Order.acceptedOffer.identifier' \
  ./scripts/demo-create-individual-organization.sh
grep -Fq 'Organization/_transaction' ./scripts/demo-create-individual-organization.sh
grep -Fq 'SMART_TOKEN_AUDIENCE="${SMART_TOKEN_ENDPOINT}"' \
  ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'submit_consent_batch_and_verify_asset INDIVIDUAL_CONSENT_BATCH_REQUEST' \
  ./scripts/smoke-smart-access-local-network.sh
grep -Fq "case 'INDIVIDUAL_CONSENT_BATCH_REQUEST':" \
  ./scripts/render-demo-smart-access-payload.mts
grep -Fq "case 'INDIVIDUAL_RULE_ID_LIST':" \
  ./scripts/render-demo-smart-access-payload.mts
grep -Fq 'clientAssertionAudience = process.env.SMART_TOKEN_AUDIENCE' \
  ./scripts/render-demo-smart-access-payload.mts
grep -Fq 'PROVIDER_ORGANIZATION_DID="${PROVIDER_ORGANIZATION_DID:-$(resolve_provider_organization_did)}"' \
  ./scripts/smoke-smart-access-local-network.sh

if grep -Fq '../../gdc-common-utils-ts/src/' ./scripts/render-demo-smart-access-payload.mts; then
  echo 'ERROR: release payload rendering must not import sibling workspace source.' >&2
  exit 1
fi

if grep -Fq '"$WORKSPACE_ROOT"' ./docker_build_local.sh; then
  echo 'ERROR: the local Docker build must not send the workspace root.' >&2
  exit 1
fi
if grep -Eq 'COPY (gwtemplate-node-ts|gdc-common-utils-ts)' ./Dockerfile; then
  echo 'ERROR: the Dockerfile must consume only the repository-scoped context.' >&2
  exit 1
fi
if grep -Eq 'COPY .*\.env' ./Dockerfile; then
  echo 'ERROR: runtime profiles must be injected, never copied into the image.' >&2
  exit 1
fi

echo 'Local image release scripts validated.'
