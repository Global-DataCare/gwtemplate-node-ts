#!/usr/bin/env bash
# Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
# A clean checkout contains every authored chaincode and host governance runtime
# required by the mandatory local-Fabric evidence.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash -n ./docker_build_local.sh ./docker_run_local.sh ./cloud_deploy.sh \
  ./scripts/smoke-docker-local-network.sh ./scripts/prepare-consentaccess-local-fabric-env.sh \
  ./scripts/collect-open-source-production-readiness-evidence.sh \
  ./scripts/smoke-helm-local-network.sh \
  ./scripts/warm-local-fabric-chaincodes.sh \
  ./chaincode/scripts/consentaccess-local-devnet.sh

node --test ./scripts/tests/openapi-core-boundary.test.mjs
bash ./scripts/tests/consentaccess-multi-host-lifecycle.test.sh
bash ./scripts/tests/public-gw-core-image-docs.test.sh

forbidden_product_pattern="pet${EMPTY_VALUE:-}chain|vet${EMPTY_VALUE:-}chain|pet${EMPTY_VALUE:-}d|sos${EMPTY_VALUE:-}chain|u${EMPTY_VALUE:-}hc|u${EMPTY_VALUE:-}nid|acc${EMPTY_VALUE:-}uro"
if rg -n -i "$forbidden_product_pattern" \
  ./CHANGELOG.md \
  ./docs/PORTAL_API_TO_GW_CORE.md \
  ./docs/BREAK_GLASS.md \
  ./.codex/skills/govern-digital-twin-consent/SKILL.md; then
  echo 'ERROR: shared release artifacts must remain product-neutral.' >&2
  exit 1
fi

grep -qx 'node_modules' .dockerignore
grep -qx 'build' .dockerignore
grep -qx '.git' .dockerignore
grep -qx '.env\*' .dockerignore
grep -qx 'chaincode' .dockerignore
grep -qx 'infra/fabric/local-network' .dockerignore
grep -Fq 'Context: ${SCRIPT_DIR}' ./docker_build_local.sh
grep -Fq '"$SCRIPT_DIR"' ./docker_build_local.sh
grep -Fq '"$SCRIPT_DIR"' ./cloud_deploy.sh
grep -Fq 'resolve_pushed_digest' ./cloud_deploy.sh
grep -Fq 'DEPLOY_DRY_RUN' ./cloud_deploy.sh
grep -Fq 'DATASPACE_ICA_ROOT=' ./scripts/run-secure-e2e-google-user.sh
grep -Fq 'npm run api:local' ./scripts/run-secure-e2e-google-user.sh
grep -Fq 'curl -fsS "${ICA_BASE_URL}/"' ./scripts/run-secure-e2e-google-user.sh
grep -Fq 'ICA_URL_INTERNAL="$ICA_BASE_URL"' ./scripts/run-secure-e2e-google-user.sh
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER="$HOST_LEGACY_REPRESENTATIVE_CONTROLLER"' ./cloud_deploy.sh
grep -Fq '"AUTH_TOKEN_VERIFIER" "OIDC_TRUSTED_PROVIDERS_JSON" "TENANT_SERVICE_ROUTES_JSON"' ./cloud_deploy.sh
grep -Fq '"GCP_KMS_RUNTIME_KEK_CIPHERTEXT" "GCP_KMS_RUNTIME_KEK_ID"' ./cloud_deploy.sh
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER=false' ./env.example
grep -Fq 'ALLOWED_SECTORS is required for every gateway deployment' ./cloud_deploy.sh
grep -Fq 'ALLOWED_SECTORS=health-research,health-care,health-index,onehealth-research' ./env.example
grep -Fq 'LOCAL_IMAGE_NAME="${LOCAL_IMAGE_NAME:-gwtemplate}"' ./demo-deploy.config.example

for chaincode_entrypoint in chaincode/*-javascript/index.js; do
  chaincode_dir="${chaincode_entrypoint%/index.js}"
  while IFS= read -r runtime_import; do
    runtime_file="${chaincode_dir}/${runtime_import#./}.js"
    git ls-files --error-unmatch "$runtime_file" >/dev/null 2>&1 || {
      echo "ERROR: chaincode runtime source is absent from a clean checkout: ${runtime_file}" >&2
      exit 1
    }
  done < <(rg -o "\./lib/[^\"']+" "$chaincode_entrypoint")
done

for host_runtime_file in \
  scripts/governance/lib/canonical-json.mjs \
  scripts/governance/lib/decision.mjs \
  scripts/governance/lib/jws.mjs \
  scripts/governance/lib/planner.mjs \
  scripts/onboarding/lib/workflow.mjs; do
  git ls-files --error-unmatch "${host_runtime_file}" >/dev/null 2>&1 || {
    echo "ERROR: host governance runtime is absent from a clean checkout: ${host_runtime_file}" >&2
    exit 1
  }
done

while IFS= read -r env_example; do
  if grep -q '^MAINSECTOR=' "$env_example" \
    && ! grep -q '^ALLOWED_SECTORS=.*onehealth-research' "$env_example"; then
    echo "ERROR: ${env_example} must declare canonical ALLOWED_SECTORS with onehealth-research." >&2
    exit 1
  fi
done < <(git ls-files 'env*.example')
bash ./scripts/smoke-docker-local-network.sh --help | grep -q 'Fabric local-network'
grep -Fq 'PERSISTENCE_PROFILE=postgres-ipfs' package.json
grep -Fq 'infra/fabric/local-network' ./scripts/bootstrap-local-fabric-stack.mjs
grep -Fq "COMPOSE_FILE: resolve(fabricDevnetRoot, 'docker-compose.yml')" \
  ./scripts/bootstrap-local-fabric-stack.mjs
grep -Fq "COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME || 'gdc-public-local-network'" \
  ./scripts/bootstrap-local-fabric-stack.mjs
grep -Fq 'FABRIC_TOOLS_CONTAINER: `${process.env.GDC_CONTAINER_PREFIX || '\''gdc'\''}-fabric-tools`' \
  ./scripts/bootstrap-local-fabric-stack.mjs
grep -Fq 'awk '\''$2 ~ /^dev-peer0-host/ {print $1}'\''' ./scripts/bootstrap-local-fabric-stack.mjs
grep -Fq 'infra/fabric/local-network' ./chaincode/scripts/consentaccess-local-devnet.sh
grep -Fq 'npm ci' ./chaincode/scripts/consentaccess-local-devnet.sh
grep -Fq 'helm:test:host' package.json
test -f ./infra/fabric/local-network/docker-compose.yml
grep -Fq 'rm -f "${DST_ICA}/tls-cert.pem"' ./infra/fabric/local-network/scripts/00-copy-dev-cas.sh
grep -Fq 'ca-tls-bundle.pem' ./infra/fabric/local-network/scripts/00-copy-dev-cas.sh
grep -Fq 'ca-tls-bundle.pem' ./infra/fabric/local-network/scripts/00-copy-dataspace-ca.sh
grep -Fq 'FABRIC_CA_SERVER_CA_CHAINFILE=/etc/hyperledger/fabric-ca-server/ca-tls-bundle.pem' \
  ./infra/fabric/local-network/docker-compose.yml
grep -Fq 'function normalize_enrolled_msp_trust()' ./infra/fabric/local-network/scripts/02-bootstrap-network.sh
grep -Fq 'function normalize_enrolled_tls_trust()' ./infra/fabric/local-network/scripts/02-bootstrap-network.sh
grep -Fq 'function wait_for_peer()' ./infra/fabric/local-network/scripts/02-bootstrap-network.sh
grep -Fq 'wait_for_peer "peer0-host1:7051"' ./infra/fabric/local-network/scripts/02-bootstrap-network.sh
git check-ignore -q ./infra/fabric/local-network/crypto/ca/root/ca-key.pem
git check-ignore -q ./infra/fabric/local-network/organizations/private-key.pem
test -f ./charts/gdc-host/Chart.yaml
test -f ./scripts/test-portable-host-helm.sh
bash ./scripts/smoke-helm-local-network.sh --preflight-only | grep -Fq 'Preflight Helm local-network superado.'
grep -Fq 'CONFIDENTIAL_JWE_INLINE_MAX_BYTES=1' ./scripts/smoke-helm-local-network.sh
grep -Fq 'La prueba Helm no persistió ningún JWE cifrado en IPFS.' ./scripts/smoke-helm-local-network.sh
grep -Fq 'peer.enabled=true' ./scripts/smoke-helm-local-network.sh
grep -Fq 'KIND_PEER_DOMAIN="peer-kind.${KIND_PEER_ORG_DOMAIN}"' ./scripts/smoke-helm-local-network.sh
grep -Fq 'GDC_CONTAINER_PREFIX="${GDC_CONTAINER_PREFIX:-gdc-public}"' ./scripts/smoke-helm-local-network.sh
grep -Fq 'DEVNET_NETWORK_NAME="${DEVNET_NETWORK_NAME:-gdc-public-local-network}"' ./scripts/smoke-helm-local-network.sh
grep -Fq 'assert_public_fabric_mounts' ./scripts/smoke-helm-local-network.sh
grep -Fq 'kind load image-archive' ./scripts/smoke-helm-local-network.sh
grep -Fq 'HOST_RUNTIME_IMAGE_ARCHIVE=' ./scripts/smoke-helm-local-network.sh
grep -Fq 'DOCKER_CONFIG="${PUBLIC_DOCKER_CONFIG}" docker pull' ./scripts/smoke-helm-local-network.sh
grep -Fq 'normalize_kind_peer_identity' ./scripts/smoke-helm-local-network.sh
grep -Fq 'COPYFILE_DISABLE=1 tar -C "${KIND_PEER_DIR}/msp"' ./scripts/smoke-helm-local-network.sh
grep -Fq 'peer channel join' ./scripts/smoke-helm-local-network.sh
grep -Fq 'peer node status' ./scripts/smoke-helm-local-network.sh
grep -Fq 'tlsintermediatecerts' ./scripts/smoke-helm-local-network.sh
grep -Fq 'CORE_PEER_LOCALMSPID=Host1MSP' ./scripts/smoke-helm-local-network.sh
grep -Fq 'kind_peer_channels=' ./scripts/smoke-helm-local-network.sh
grep -Fq 'install_kind_ccaas_chaincodes' ./scripts/smoke-helm-local-network.sh
test -x ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq 'peer lifecycle chaincode install' ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq 'peer lifecycle chaincode approveformyorg' ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq 'touch -t 198001010000' ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq 'tar --format ustar --uid 0 --gid 0' ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq 'gzip -n' ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq '.source.Type.LocalPackage.package_id == $package_id' ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq '.version == $version and .sequence == 1 and .approvals[$msp] == true' \
  ./scripts/install-kind-ccaas-chaincodes.sh
grep -Fq 'gw.fabricPeerEndpoint="${KIND_PEER_SERVICE}:7051"' ./scripts/smoke-helm-local-network.sh
grep -Fq 'name: orderer-tcp-bridge' ./scripts/smoke-helm-local-network.sh
grep -Fq 'name: orderer' ./scripts/smoke-helm-local-network.sh
grep -Fq 'peer.bootstrap=' ./scripts/smoke-helm-local-network.sh
grep -Fq 'KIND_PEER_SYNC_ATTEMPTS="${KIND_PEER_SYNC_ATTEMPTS:-600}"' ./scripts/smoke-helm-local-network.sh
grep -Fq 'wait_for_kind_peer_sync' ./scripts/smoke-helm-local-network.sh
grep -Fq -- '--set gw.enabled=false' ./scripts/smoke-helm-local-network.sh
grep -Fq -- '--reuse-values' ./scripts/smoke-helm-local-network.sh
grep -Fq 'kind_peer_ccaas=' ./scripts/smoke-helm-local-network.sh
grep -Fq 'gw_fabric_peer=' ./scripts/smoke-helm-local-network.sh
grep -Fq 'FABRIC_QUERY_MODE=kubectl' ./scripts/smoke-helm-local-network.sh
grep -Fq 'FABRIC_QUERY_MODE:-docker' ./scripts/smoke-consentaccess-local-network.sh
grep -Fq 'FABRIC_QUERY_MODE:-docker' ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'kubectl --context "${FABRIC_KUBE_CONTEXT}"' ./scripts/smoke-consentaccess-local-network.sh
grep -Fq 'kubectl --context "${FABRIC_KUBE_CONTEXT}"' ./scripts/smoke-smart-access-local-network.sh
if grep -Fq 'Mantiene el GW sobre el peer Docker' ./scripts/smoke-helm-local-network.sh; then
  echo 'ERROR: Helm evidence still permits GW traffic through the Docker peer.' >&2
  exit 1
fi
if grep -Fq 'get service peer0-host1' ./scripts/smoke-helm-local-network.sh; then
  echo 'ERROR: the network discovery route must not be confused with the GW endorsement route.' >&2
  exit 1
fi
grep -Fq 'height[^0-9]*[1-9]' ./scripts/smoke-helm-local-network.sh
grep -Fq 'gw.fabricPeerEndpoint' ./charts/gdc-host/templates/gw-configmap.yaml
grep -Fq 'cat /tls/tlsintermediatecerts/*.pem >> /tls/server.crt' ./charts/gdc-host/templates/peer.yaml
grep -Fq 'test:host-preauthorization' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq 'evidence:migration:postgres-ipfs' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq '21-dataspace-ica-postgres-ipfs-migration' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq 'migración Firestore/GCS a PostgreSQL/IPFS' ./deliverables/ENTREGABLE_HOST_REPRODUCIBLE_ES.md
grep -Fq '21-dataspace-ica-postgres-ipfs-migration' ./deliverables/GUIA_HOST_REPRODUCIBLE_ES.html
grep -Fq 'ENTREGABLE_LOCAL_REPRODUCIBLE_ES.md' ./deliverables/README.md
grep -Fq 'MIGRACION_Y_DESPLIEGUE_ICA_ES.md' ./deliverables/README.md
grep -Fq 'PUESTA_EN_MARCHA_HOST_ES.md' ./deliverables/README.md
grep -Fq 'RESUMEN_OPERATIVO_Y_ENLACES_ES.md' ./deliverables/README.md
grep -Fq 'npm run evidence:open-source-production-readiness' ./deliverables/ENTREGABLE_LOCAL_REPRODUCIBLE_ES.md
grep -Fq 'evidence:migration:postgres-ipfs' ./deliverables/MIGRACION_Y_DESPLIEGUE_ICA_ES.md
grep -Fq 'request-host-credential.mjs' ./deliverables/PUESTA_EN_MARCHA_HOST_ES.md
grep -Fq 'host:activation:create' ./deliverables/PUESTA_EN_MARCHA_HOST_ES.md
grep -Fq 'host-activation-approval.example.json' ./deliverables/PUESTA_EN_MARCHA_HOST_ES.md
grep -Fq -- '--approval-stdin' ./deliverables/PUESTA_EN_MARCHA_HOST_ES.md
grep -Fq 'HostActivation' ./scripts/onboarding/request-host-credential.mjs
grep -Fq 'approved host data' ./scripts/onboarding/request-host-credential.mjs
grep -Fq 'https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/deliverables/' ./deliverables/RESUMEN_OPERATIVO_Y_ENLACES_ES.md
grep -Fq 'request-host-credential.mjs' ./deliverables/RESUMEN_OPERATIVO_Y_ENLACES_ES.md
if grep -Fq 'INSTRUCCIONES_OPERADOR_MIGRACION_ICA_ES.md' ./deliverables/RESUMEN_OPERATIVO_Y_ENLACES_ES.md; then
  echo 'Public handoff must not link private provider instructions.' >&2
  exit 1
fi
node --test ./scripts/onboarding/tests/host-credential-bootstrap.test.mjs
grep -Fq 'HOME_PLACEHOLDER' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq 'absolute user-home path' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq 'instala y aprueba los nueve paquetes CCAAS' \
  ./scripts/collect-open-source-production-readiness-evidence.sh
if grep -Fq 'fabric-multicloud' ./scripts/collect-open-source-production-readiness-evidence.sh; then
  echo 'ERROR: the public evidence runner must not require a private Fabric repository.' >&2
  exit 1
fi
grep -Fq 'Open-source persistence validated' ./scripts/smoke-docker-local-network.sh
grep -Fq 'GDC_CONTAINER_PREFIX="${GDC_CONTAINER_PREFIX:-gdc-public}"' ./scripts/smoke-docker-local-network.sh
grep -Fq 'DEVNET_NETWORK_NAME="${DEVNET_NETWORK_NAME:-gdc-public-local-network}"' ./scripts/smoke-docker-local-network.sh
grep -Fq 'warm-local-fabric-chaincodes.sh' ./scripts/smoke-docker-local-network.sh
grep -Fq 'BASE_URL="$BASE_URL" FABRIC_TOOLS_CONTAINER="$FABRIC_TOOLS_CONTAINER"' \
  ./scripts/smoke-docker-local-network.sh
grep -Fq 'Host1MSP' ./scripts/warm-local-fabric-chaincodes.sh
grep -Fq 'tenant_rehydration=ok' ./scripts/smoke-docker-local-network.sh
grep -Fq 'ready_status_count' ./scripts/smoke-consentaccess-local-network.sh
grep -Fq 'poll_async_until' ./scripts/bootstrap-single-tenant.sh
grep -Fq '.body.data[0].resource.meta.claims["org.schema.Offer.identifier"]' \
  ./scripts/bootstrap-single-tenant.sh
if rg -n '"/body/data/0/meta/claims/' \
  ./scripts/bootstrap-single-tenant.sh \
  ./scripts/demo-create-individual-organization.sh \
  ./scripts/portal-web-go-no-go.sh \
  || rg -n 'body\.data\[0\]\.meta\.claims\[[^]]+\][[:space:]]*=' \
  ./scripts/run-api-integrators-guide-flow.mts; then
  echo 'ERROR: an executable acceptance flow still authors legacy entry.meta.claims.' >&2
  exit 1
fi
grep -Fq '"/body/data/0/resource/meta/claims/org.schema.Organization.identifier.value"' \
  ./scripts/bootstrap-single-tenant.sh
docker compose -f ./docker-compose.open-source-local.yml config >/dev/null
node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q -- '--prepare-only'
node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q 'LOCAL_FABRIC_CA_SOURCE=dataspace-ca'
node --check ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'Host1MSP' ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'Host2MSP' ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq 'identity-eu' ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq 'identity-global' ./scripts/build-open-source-evidence-manifest.mjs
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
grep -Fq 'digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search' ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'ResearchSubject-search-response-v1.0' ./scripts/smoke-smart-access-local-network.sh
if grep -Fq 'digitaltwin/org.hl7.fhir.r4/Composition/_search' ./scripts/smoke-smart-access-local-network.sh; then
  echo 'ERROR: the public research smoke must not use Composition/_search.' >&2
  exit 1
fi
grep -Fq 'medical-secretary-consent-smart-bundle-search-allow' \
  ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'humanAccessProof' ./scripts/build-open-source-evidence-manifest.mjs
grep -Fq "Password: (?!\\[REDACTED\\])" ./scripts/collect-open-source-production-readiness-evidence.sh
grep -Fq '60-public-secret-scan' ./scripts/collect-open-source-production-readiness-evidence.sh

if grep -Fq '../../gdc-common-utils-ts/src/' ./scripts/render-demo-smart-access-payload.mts; then
  echo 'ERROR: release payload rendering must not import sibling workspace source.' >&2
  exit 1
fi
if grep -Fq '../../gdc-common-utils-ts/src/' ./scripts/render-demo-consentaccess-payload.mts; then
  echo 'ERROR: Consent release payload rendering must use the installed common-utils contract.' >&2
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
if rg -n 'git\+(ssh|https)|git@github\.com|github\.com/.+\.git|github:.+#|file:vendor|file:workspace' \
  ./package.json ./package-lock.json ./Dockerfile; then
  echo 'ERROR: release images must consume immutable npm registry dependencies, never Git, workspace or vendor package sources.' >&2
  exit 1
fi
if [[ "$(grep -Ec '^RUN npm ci($| )' ./Dockerfile)" -ne 2 ]]; then
  echo 'ERROR: both Docker stages must install the exact lockfile with npm ci.' >&2
  exit 1
fi

echo 'Local image release scripts validated.'
