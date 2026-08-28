#!/usr/bin/env bash
# Flow contract:
# 1. the Helm peer belongs to dynamically admitted Host2MSP, not bootstrap Host1MSP;
# 2. Host2 installs and approves all nine local CCAAS packages;
# 3. GW targets that Kubernetes Host2 peer for the E2E and restart proof.
# Authorization invariant: the committed policy permits either governed host MSP to endorse.
# Persistence invariant: Host2 peer membership and CCAAS readiness survive restart.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SMOKE="${ROOT}/scripts/smoke-helm-local-network.sh"
CCAAS="${ROOT}/scripts/install-kind-ccaas-chaincodes.sh"
RUNNER="${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"

grep -Fq 'KIND_PEER_MSP_ID="Host2MSP"' "${SMOKE}"
grep -Fq 'host2.example.com' "${SMOKE}"
grep -Fq 'HOST_AUTHORIZATION_JSON' "${SMOKE}"
grep -Fq 'gdc.hostCredentialId' "${SMOKE}"
grep -Fq 'KIND_GW_MSP' "${SMOKE}"
grep -Fq 'LEDGER_FABRIC_MSP_ID=${KIND_PEER_MSP_ID}' "${SMOKE}"
grep -Fq 'HLF_MSP_ID_HOST1=${KIND_PEER_MSP_ID}' "${SMOKE}"
grep -Fq 'HLF_CERTIFICATE=$(to_env_one_line_pem "${KIND_GW_CERT}")' "${SMOKE}"
grep -Fq 'HLF_PRIVATE_KEY=$(to_env_one_line_pem "${KIND_GW_KEY}")' "${SMOKE}"
! grep -Fq 'local-evidence-host-credential' "${SMOKE}"
grep -Fq 'CORE_PEER_LOCALMSPID="${KIND_PEER_MSP_ID}"' "${CCAAS}"
grep -Fq "OR('Host1MSP.member','Host2MSP.member')" "${CCAAS}"
grep -Fq 'SKIP_FABRIC_PREP=true' "${RUNNER}"
grep -Fq 'create-local-audit-authorization.mjs' "${RUNNER}"
grep -Fq 'HOST_AUTHORIZATION_JSON=' "${RUNNER}"
grep -Fq 'local-fabric-admission.mjs' "${RUNNER}"
grep -Fq 'scripts/governance/reconcile.mjs' "${RUNNER}"
grep -Fq 'users/GW@host2.example.com/msp/signcerts/cert.pem' "${RUNNER}"
grep -Fq 'gdc.hostCredentialId' "${RUNNER}"
