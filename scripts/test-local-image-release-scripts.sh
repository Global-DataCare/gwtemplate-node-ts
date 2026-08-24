#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash -n ./docker_build_local.sh ./docker_run_local.sh ./cloud_deploy.sh \
  ./scripts/smoke-docker-local-network.sh ./scripts/prepare-consentaccess-local-fabric-env.sh \
  ./scripts/collect-open-source-production-readiness-evidence.sh

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
grep -Fq '"AUTH_TOKEN_VERIFIER" "TENANT_SERVICE_ROUTES_JSON"' ./cloud_deploy.sh
grep -Fq '"GCP_KMS_RUNTIME_KEK_CIPHERTEXT" "GCP_KMS_RUNTIME_KEK_ID"' ./cloud_deploy.sh
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
grep -Fq 'PERSISTENCE_PROFILE=postgres-ipfs' package.json
grep -Fq 'Open-source persistence validated' ./scripts/smoke-docker-local-network.sh
grep -Fq 'tenant_rehydration=ok' ./scripts/smoke-docker-local-network.sh
grep -Fq 'ready_status_count' ./scripts/smoke-consentaccess-local-network.sh
grep -Fq 'poll_async_until' ./scripts/bootstrap-single-tenant.sh
docker compose -f ./docker-compose.open-source-local.yml config >/dev/null
node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q -- '--prepare-only'
node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q 'LOCAL_FABRIC_CA_SOURCE=dataspace-ca'
node --check ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'Host1MSP' ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'Host2MSP' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq 'identity-eu' ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'identity-global' ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'excludedScope' ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'FABRIC_PEER_ENDPOINT_VALUE="${FABRIC_PEER_ENDPOINT_VALUE:-localhost:7051}"' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER=${LEGACY_REPRESENTATIVE_CONTROLLER_VALUE}' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'TENANT_SERVICE_ROUTES_JSON=${TENANT_SERVICE_ROUTES_JSON_VALUE}' \
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
grep -Fq 'SECRETARY_SMART_TOKEN_REQUEST_ALLOW' ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'SECRETARY_SMART_TOKEN_REQUEST_DENY' ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'medical-secretary-consent-smart-bundle-search-allow' \
  ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'humanAccessProof' ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'Password: [REDACTED]' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq '60-public-secret-scan' ./scripts/collect-open-source-production-readiness-evidence.sh

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
