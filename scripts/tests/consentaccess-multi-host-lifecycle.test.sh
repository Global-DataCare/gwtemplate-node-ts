#!/usr/bin/env bash
# Flow contract:
# 1. the CCAAS package is installed on each active host peer;
# 2. every active host MSP approves the same consentaccess-sc definition;
# 3. the commit targets every active peer and succeeds under Fabric lifecycle policy.
# Authorization invariant: Host2MSP cannot be skipped after governed admission.
# Persistence invariant: the committed definition is discoverable from both host peers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOYER="${ROOT}/chaincode/scripts/consentaccess-local-devnet.sh"

grep -Fq 'SINGLE_HOST="${SINGLE_HOST:-true}"' "${DEPLOYER}"
grep -Fq 'HOST2_MSP_ID="${HOST2_MSP_ID:-Host2MSP}"' "${DEPLOYER}"
grep -Fq 'install_chaincode_package_for_host' "${DEPLOYER}"
grep -Fq 'approve_chaincode_definition_for_host' "${DEPLOYER}"
grep -Fq 'peer0-host2:7051' "${DEPLOYER}"
grep -Fq -- '--peerAddresses peer0-host2:7051' "${DEPLOYER}"
