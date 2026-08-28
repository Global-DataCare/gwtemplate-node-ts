#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Consent Access CCAAS local devnet deployer
#
# This script prepares, installs and commits the `consentaccess-sc` chaincode as
# an external service on the bundled public Fabric local-network.
#
# The script is intentionally explicit so a developer who does not know Fabric
# can follow each step and override only a few variables when needed.
#
# Important local assumptions:
# - the real source of truth is this repository's public local-network
# - the local devnet channel for consent access is `health-care-local`
# - the smart contract is deployed as CCAAS, not as in-peer chaincode
# - `weft` is optional here; when it is missing this script builds the standard
#   Fabric CCAAS archive (`metadata.json` + `code.tar.gz`) directly
# - this script assumes the devnet itself is already able to bootstrap a clean
#   orderer/peer/channel state from deterministic CA material
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "${ROOT}/.." && pwd)"
CHAINCODE_DIR="${ROOT}/consentaccess-sc-javascript"
DEVNET_ROOT="${FABRIC_DEVNET_ROOT:-${REPO_ROOT}/infra/fabric/local-network}"
ENSURE_DEVNET_ENV_SCRIPT="${REPO_ROOT}/scripts/ensure-fabric-devnet-env.sh"

CHANNEL_NAME="${CHANNEL_NAME:-${HLF_DATA_CHANNEL_NAME:-health-care-local}}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_SIGNATURE_POLICY="${CHAINCODE_SIGNATURE_POLICY:-OR('Host1MSP.member')}"
CHAINCODE_LABEL="${CHAINCODE_LABEL:-consentaccess-sc}"
CHAINCODE_SERVER_CONTAINER_NAME="${CHAINCODE_SERVER_CONTAINER_NAME:-consentaccess-sc}"
CHAINCODE_SERVER_PORT="${CHAINCODE_SERVER_PORT:-9999}"
CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS:-${CHAINCODE_SERVER_CONTAINER_NAME}:${CHAINCODE_SERVER_PORT}}"
CHAINCODE_IMAGE_TAG="${CHAINCODE_IMAGE_TAG:-consentaccess-sc:latest}"
CHAINCODE_PACKAGE_ARCHIVE="${CHAINCODE_PACKAGE_ARCHIVE:-consentaccess-sc-caas.tgz}"
SINGLE_HOST="${SINGLE_HOST:-true}"
DEVNET_NETWORK="${DEVNET_NETWORK:-gdc-fabric-v3-devnet}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
ORDERER_TLS_HOSTNAME="${ORDERER_TLS_HOSTNAME:-orderer}"
ORDERER_ADDRESS="${ORDERER_ADDRESS:-orderer:7050}"
HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"
HOST2_DOMAIN="${HOST2_DOMAIN:-host2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"
HOST1_MSP_ID="${HOST1_MSP_ID:-Host1MSP}"
HOST2_MSP_ID="${HOST2_MSP_ID:-Host2MSP}"

HOST1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"
HOST1_PEER_TLS="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"
HOST2_ADMIN_MSP="/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp"
HOST2_PEER_TLS="/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt"
ORDERER_TLS_CA="/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt"

function info() {
  printf '\n==> %s\n' "$1"
}

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

function require_file() {
  local target="$1"
  [[ -f "${target}" ]] || fail "Missing file: ${target}"
}

function require_dir() {
  local target="$1"
  [[ -d "${target}" ]] || fail "Missing directory: ${target}"
}

function require_command() {
  local target="$1"
  command -v "${target}" >/dev/null 2>&1 || fail "Missing command: ${target}"
}

function exec_tools() {
  docker exec -w /workspace "${FABRIC_TOOLS_CONTAINER}" "$@"
}

function ensure_devnet_ready() {
  require_dir "${DEVNET_ROOT}"
  require_dir "${CHAINCODE_DIR}"
  require_command docker
  require_command npm
  require_command cp
  require_file "${ENSURE_DEVNET_ENV_SCRIPT}"

  [[ -S /var/run/docker.sock ]] || fail "Docker socket not available"
  docker ps --format '{{.Names}}' | grep -qx "${FABRIC_TOOLS_CONTAINER}" \
    || fail "Fabric tools container is not running: ${FABRIC_TOOLS_CONTAINER}"
  require_file "${DEVNET_ROOT}/channel-artifacts/${CHANNEL_NAME}.block"

  info "Ensuring the Fabric devnet backend env exists"
  bash "${ENSURE_DEVNET_ENV_SCRIPT}"
}

function package_chaincode_archive_without_weft() {
  # Fabric CCAAS packages are just:
  # - metadata.json
  # - code.tar.gz containing connection.json
  #
  # `weft` is convenient but not required for that shape, so the local script
  # can generate the archive directly and stay runnable on workstations that do
  # not have the extra packaging tool installed.
  local package_root
  package_root="$(mktemp -d)"
  local code_root="${package_root}/code"
  local connection_json="${code_root}/connection.json"
  local metadata_json="${package_root}/metadata.json"

  mkdir -p "${code_root}"

  cat > "${connection_json}" <<EOF
{"address":"${CHAINCODE_SERVER_ADDRESS}","dial_timeout":"10s","tls_required":false}
EOF

  cat > "${metadata_json}" <<EOF
{"path":"","type":"ccaas","label":"${CHAINCODE_LABEL}"}
EOF

  (cd "${code_root}" && tar -czf "${package_root}/code.tar.gz" connection.json)
  (cd "${package_root}" && tar -czf "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" metadata.json code.tar.gz)

  rm -rf "${package_root}"
}

function build_chaincode_artifacts() {
  info "Installing exact consentaccess-sc dependencies"
  (cd "${CHAINCODE_DIR}" && npm ci)

  info "Running unit tests for consentaccess-sc"
  (cd "${CHAINCODE_DIR}" && npm test)

  info "Generating metadata.json"
  (cd "${CHAINCODE_DIR}" && npm run metadata)

  info "Packaging CCAAS archive"
  if command -v weft >/dev/null 2>&1; then
    (cd "${CHAINCODE_DIR}" && CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS}" npm run package:caas)
  else
    package_chaincode_archive_without_weft
  fi
  require_file "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}"

  info "Building the external service image"
  (cd "${CHAINCODE_DIR}" && docker build \
    --build-arg TARGETOS="${CHAINCODE_TARGET_OS:-linux}" \
    --build-arg TARGETARCH="${CHAINCODE_TARGET_ARCH:-amd64}" \
    --target ccaas -f ./Dockerfile -t "${CHAINCODE_IMAGE_TAG}" .)
}

function copy_archive_to_devnet() {
  info "Copying the CCAAS archive into the devnet workspace"
  cp "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" "${DEVNET_ROOT}/channel-artifacts/${CHAINCODE_PACKAGE_ARCHIVE}"
}

function install_chaincode_package_for_host() {
  local msp_id="$1"
  local peer_address="$2"
  local admin_msp="$3"
  local peer_tls="$4"

  info "Installing ${CHAINCODE_PACKAGE_ARCHIVE} on ${peer_address} (${msp_id})"
  exec_tools env \
    CORE_PEER_LOCALMSPID="${msp_id}" \
    CORE_PEER_ADDRESS="${peer_address}" \
    CORE_PEER_MSPCONFIGPATH="${admin_msp}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${peer_tls}" \
    peer lifecycle chaincode install "/workspace/channel-artifacts/${CHAINCODE_PACKAGE_ARCHIVE}"
}

function install_chaincode_package() {
  install_chaincode_package_for_host \
    "${HOST1_MSP_ID}" "peer0-host1:7051" "${HOST1_ADMIN_MSP}" "${HOST1_PEER_TLS}"
  if [[ "${SINGLE_HOST}" != "true" ]]; then
    install_chaincode_package_for_host \
      "${HOST2_MSP_ID}" "peer0-host2:7051" "${HOST2_ADMIN_MSP}" "${HOST2_PEER_TLS}"
  fi
}

function resolve_package_id() {
  exec_tools env \
    CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
    peer lifecycle chaincode queryinstalled \
    | awk -v label="${CHAINCODE_LABEL}" '$0 ~ label {gsub(/,/, "", $3); print $3}' \
    | tail -n 1
}

function restart_external_service() {
  local package_id="$1"

  info "Restarting the external service container"
  docker rm -f "${CHAINCODE_SERVER_CONTAINER_NAME}" >/dev/null 2>&1 || true

  docker run -d \
    --name "${CHAINCODE_SERVER_CONTAINER_NAME}" \
    --network "${DEVNET_NETWORK}" \
    -e CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS}" \
    -e CHAINCODE_ID="${package_id}" \
    -p "${CHAINCODE_SERVER_PORT}:${CHAINCODE_SERVER_PORT}" \
    "${CHAINCODE_IMAGE_TAG}" >/dev/null
}

function approve_chaincode_definition_for_host() {
  local package_id="$1"
  local msp_id="$2"
  local peer_address="$3"
  local admin_msp="$4"
  local peer_tls="$5"

  info "Approving the chaincode definition for ${msp_id}"
  exec_tools env \
    CORE_PEER_LOCALMSPID="${msp_id}" \
    CORE_PEER_ADDRESS="${peer_address}" \
    CORE_PEER_MSPCONFIGPATH="${admin_msp}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${peer_tls}" \
    peer lifecycle chaincode approveformyorg \
    -o "${ORDERER_ADDRESS}" \
    --ordererTLSHostnameOverride "${ORDERER_TLS_HOSTNAME}" \
    --tls \
    --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --package-id "${package_id}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    --signature-policy "${CHAINCODE_SIGNATURE_POLICY}"
}

function approve_chaincode_definition() {
  local package_id="$1"

  approve_chaincode_definition_for_host \
    "${package_id}" "${HOST1_MSP_ID}" "peer0-host1:7051" "${HOST1_ADMIN_MSP}" "${HOST1_PEER_TLS}"
  if [[ "${SINGLE_HOST}" != "true" ]]; then
    approve_chaincode_definition_for_host \
      "${package_id}" "${HOST2_MSP_ID}" "peer0-host2:7051" "${HOST2_ADMIN_MSP}" "${HOST2_PEER_TLS}"
  fi
}

function commit_chaincode_definition() {
  info "Committing the chaincode definition on ${CHANNEL_NAME}"
  if [[ "${SINGLE_HOST}" == "true" ]]; then
    exec_tools env \
      CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
      CORE_PEER_ADDRESS="peer0-host1:7051" \
      CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
      peer lifecycle chaincode commit \
      -o "${ORDERER_ADDRESS}" \
      --ordererTLSHostnameOverride "${ORDERER_TLS_HOSTNAME}" \
      --tls --cafile "${ORDERER_TLS_CA}" \
      --channelID "${CHANNEL_NAME}" \
      --name "${CHAINCODE_NAME}" \
      --version "${CHAINCODE_VERSION}" \
      --sequence "${CHAINCODE_SEQUENCE}" \
      --signature-policy "${CHAINCODE_SIGNATURE_POLICY}" \
      --peerAddresses peer0-host1:7051 \
      --tlsRootCertFiles "${HOST1_PEER_TLS}"
  else
    exec_tools env \
      CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
      CORE_PEER_ADDRESS="peer0-host1:7051" \
      CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
      peer lifecycle chaincode commit \
      -o "${ORDERER_ADDRESS}" \
      --ordererTLSHostnameOverride "${ORDERER_TLS_HOSTNAME}" \
      --tls --cafile "${ORDERER_TLS_CA}" \
      --channelID "${CHANNEL_NAME}" \
      --name "${CHAINCODE_NAME}" \
      --version "${CHAINCODE_VERSION}" \
      --sequence "${CHAINCODE_SEQUENCE}" \
      --signature-policy "${CHAINCODE_SIGNATURE_POLICY}" \
      --peerAddresses peer0-host1:7051 \
      --tlsRootCertFiles "${HOST1_PEER_TLS}" \
      --peerAddresses peer0-host2:7051 \
      --tlsRootCertFiles "${HOST2_PEER_TLS}"
  fi
}

function print_summary() {
  local package_id="$1"

  cat <<EOF

Consent access CCAAS deployed locally.

Channel:        ${CHANNEL_NAME}
Chaincode:      ${CHAINCODE_NAME}
Version:        ${CHAINCODE_VERSION}
Sequence:       ${CHAINCODE_SEQUENCE}
Signature policy:
                ${CHAINCODE_SIGNATURE_POLICY}
Package label:  ${CHAINCODE_LABEL}
Package id:     ${package_id}
Server address: ${CHAINCODE_SERVER_ADDRESS}
Image tag:      ${CHAINCODE_IMAGE_TAG}

Recommended GW CORE env:
  LEDGER_ENABLED=true
  LEDGER_PROVIDER_DEFAULT=fabric
  LEDGER_MSP_ID=${HOST1_MSP_ID}
  LEDGER_FABRIC_MSP_ID=${HOST1_MSP_ID}
  CONSENT_ACCESS_LEDGER_CHAINCODE=${CHAINCODE_NAME}

Remember:
  ConsentManager writes to channel "\${sector}-\${jurisdiction}".
  Your consent smoke test must use sector/jurisdiction that resolve to ${CHANNEL_NAME}.
  If you rerun this script after changing chaincode packaging inputs, a new
  package id is expected. That is normal for CCAAS lifecycle installs.
EOF
}

ensure_devnet_ready
build_chaincode_artifacts
copy_archive_to_devnet
install_chaincode_package

PACKAGE_ID="$(resolve_package_id)"
[[ -n "${PACKAGE_ID}" ]] || fail "Could not resolve PACKAGE_ID for label ${CHAINCODE_LABEL}"

restart_external_service "${PACKAGE_ID}"
approve_chaincode_definition "${PACKAGE_ID}"
commit_chaincode_definition
print_summary "${PACKAGE_ID}"
