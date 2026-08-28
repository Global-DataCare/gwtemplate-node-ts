#!/usr/bin/env bash
# TDD contract: write this test red first; make it green only with the complete real behavior.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

FILES=(
  "${ROOT}/PRODUCTION-READINESS.md"
  "${ROOT}/chaincode/scripts/consentaccess-local-devnet.sh"
  "${ROOT}/scripts/bootstrap-local-fabric-stack.mjs"
  "${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"
  "${ROOT}/scripts/ensure-fabric-devnet-env.sh"
  "${ROOT}/scripts/prepare-consentaccess-local-fabric-env.sh"
  "${ROOT}/scripts/smoke-consentaccess-local-network.sh"
  "${ROOT}/scripts/smoke-consentaccess-lifecycle-local-network.sh"
  "${ROOT}/scripts/smoke-docker-local-network.sh"
  "${ROOT}/scripts/smoke-smart-access-local-network.sh"
  "${ROOT}/scripts/warm-local-fabric-chaincodes.sh"
  "${ROOT}/src/blockchain/fabric/v3/fabric-config.ts"
  "${ROOT}/src/blockchain/fabric/v3/wallets-v3.ts"
)

grep -Fq 'Host1MSP -> peer0-host1' "${ROOT}/PRODUCTION-READINESS.md"
grep -Fq 'Host2MSP -> peer0-host2' "${ROOT}/PRODUCTION-READINESS.md"
grep -Fq 'HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"' \
  "${ROOT}/scripts/prepare-consentaccess-local-fabric-env.sh"
grep -Fq 'CORE_PEER_ADDRESS=peer0-host1:7051' \
  "${ROOT}/scripts/smoke-smart-access-local-network.sh"
grep -Fq 'FABRIC_DEVNET_ROOT' "${ROOT}/scripts/bootstrap-local-fabric-stack.mjs"
grep -Fq 'CA_HOST="${CA_HOST:-ica}"' \
  "${ROOT}/infra/fabric/local-network/scripts/02-bootstrap-network.sh"
if grep -Fq 'CA_HOST=root-ca' "${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"; then
  echo 'The public evidence runner bypasses the Fabric ICA.' >&2
  exit 1
fi
if grep -Eq "CA_HOST:[[:space:]]*'root-ca'" "${ROOT}/scripts/bootstrap-local-fabric-stack.mjs"; then
  echo 'The GW bootstrap bypasses the Fabric ICA.' >&2
  exit 1
fi

if rg -n -i \
  'peer0-org[12]|org[12]\.example|org[12]msp|hlf_msp_id_org[12]|org[12]_domain' \
  "${FILES[@]}"; then
  echo 'Legacy numbered Fabric host names remain in the local runtime contract.' >&2
  exit 1
fi

echo 'GW local Fabric host naming contract: ok'
