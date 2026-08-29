#!/usr/bin/env bash
# Flow contract:
# 1. the Helm peer belongs to dynamically admitted Host2MSP, not bootstrap Host1MSP;
# 2. Host2 installs and approves all nine local CCAAS packages;
# 3. GW targets that Kubernetes Host2 peer for the E2E and restart proof.
# 4. kind imports only images used by Kubernetes workloads, while Fabric tools
#    remain in the external Docker network used for governance operations.
# 5. the first peer of a host pulls blocks from the orderer without attempting
#    to use a peer from another MSP as its gossip bootstrap.
# 6. concurrent local stacks cannot hijack the CCAAS container name or the
#    orderer port used by the kind bridge.
# Authorization invariant: the committed policy permits either governed host MSP to endorse.
# Persistence invariant: Host2 peer membership and CCAAS readiness survive restart.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SMOKE="${ROOT}/scripts/smoke-helm-local-network.sh"
CCAAS="${ROOT}/scripts/install-kind-ccaas-chaincodes.sh"
RUNNER="${ROOT}/scripts/collect-open-source-production-readiness-evidence.sh"

grep -Fq 'replayProtection: mem' "${ROOT}/charts/gdc-host/values.yaml"

grep -Fq 'KIND_PEER_MSP_ID="Host2MSP"' "${SMOKE}"
grep -Fq 'host2.example.com' "${SMOKE}"
grep -Fq 'HOST_AUTHORIZATION_JSON' "${SMOKE}"
grep -Fq 'gdc.hostCredentialSha256' "${SMOKE}"
grep -Fq 'KIND_GW_MSP' "${SMOKE}"
if grep -Fq 'tools_image=' "${SMOKE}"; then
  echo 'kind must not import the oversized Fabric tools image.' >&2
  exit 1
fi
grep -Fq -- '--image="${peer_image}"' "${SMOKE}"
if grep -Fq 'peer.bootstrap=peer0-host1:7051' "${SMOKE}"; then
  echo 'a peer from another MSP must not be configured as gossip bootstrap.' >&2
  exit 1
fi
grep -Fq 'KIND_PEER_SYNC_ATTEMPTS="${KIND_PEER_SYNC_ATTEMPTS:-600}"' "${SMOKE}"
grep -Fq 'ORDERER_HOST_PORT="${ORDERER_HOST_PORT:-7050}"' "${SMOKE}"
grep -Fq 'HOST2_PEER_HOST_PORT="${HOST2_PEER_HOST_PORT:-9051}"' "${SMOKE}"
grep -Fq 'name: orderer-tcp-bridge' "${SMOKE}"
grep -Fq 'host.docker.internal ${ORDERER_HOST_PORT}' "${SMOKE}"
grep -Fq 'name: host2-bootstrap-tcp-bridge' "${SMOKE}"
grep -Fq 'host.docker.internal ${HOST2_PEER_HOST_PORT}' "${SMOKE}"
if grep -Fq 'create service externalname orderer' "${SMOKE}"; then
  echo 'the kind bridge must honor ORDERER_HOST_PORT instead of assuming host port 7050.' >&2
  exit 1
fi
grep -Fq 'value: {{ .Values.peer.bootstrap | quote }}' "${ROOT}/charts/gdc-host/templates/peer.yaml"
grep -Fq 'range $key, $value := .Values.peer.extraEnv' "${ROOT}/charts/gdc-host/templates/peer.yaml"
grep -Fq 'peer.bootstrap=peer0-host2:7051' "${SMOKE}"
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
grep -Fq 'gdc.hostCredentialSha256' "${RUNNER}"
grep -Fq 'CHAINCODE_SERVER_CONTAINER_NAME="${CHAINCODE_SERVER_CONTAINER_NAME:-${GDC_CONTAINER_PREFIX}-consentaccess-sc}"' "${RUNNER}"
