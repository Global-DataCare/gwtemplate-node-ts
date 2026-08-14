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
bash ./scripts/smoke-docker-local-network.sh --help | grep -q 'Fabric local-network'
node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q -- '--prepare-only'
grep -Fq 'FABRIC_PEER_ENDPOINT_VALUE="${FABRIC_PEER_ENDPOINT_VALUE:-localhost:7051}"' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh

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
