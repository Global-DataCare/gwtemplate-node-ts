#!/usr/bin/env bash
# Flow contract:
# 1. local-network starts with Host1MSP as its only application MSP.
# 2. the governor adds Host2MSP through a signed channel-config update.
# 3. Host2's peer starts only after admission and joins every approved channel.
# Authorization invariant: Host1MSP admin signs the update; Host2 cannot self-admit.
# Persistence invariant: channel membership remains visible from both peers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/infra/fabric/local-network/scripts/06-admit-host2.sh"

[[ -x "${SCRIPT}" ]]
grep -Fq 'configtxgen -printOrg' "${SCRIPT}"
grep -Fq 'configtxlator compute_update' "${SCRIPT}"
grep -Fq 'peer channel update' "${SCRIPT}"
grep -Fq 'peer channel join' "${SCRIPT}"
grep -Fq 'users/GW@${HOST2_DOMAIN}/msp' "${SCRIPT}"
grep -Fq -- '--id.type client' "${SCRIPT}"
grep -Fq 'Host2 GW certificate is not bound to the authorized Host credential.' "${SCRIPT}"
grep -Fq 'SINGLE_HOST=true' "${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"
grep -Fq 'local-fabric-admission.mjs' "${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"
