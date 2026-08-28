#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Deterministic local Fabric bootstrap
#
# Why this script looks stricter than the historical version:
#
# 1. The local devnet consumes the disposable CA material selected by the
#    public evidence runner, so stale runtime state must be treated as a bug,
#    not as something to work around interactively.
#
# 2. The intermediate ICA path is still preserved, but the local bootstrap is
#    allowed to override `CA_HOST` and `CA_TLS_CERT`. This is intentional.
#    In local development we sometimes bootstrap directly against `root-ca`
#    because it is the simplest path to produce stable, locally-valid MSPs.
#
# 3. Every MSP written here gets an explicit `NodeOUs` config. Without that,
#    Fabric v2 peers/orderers reject the generated MSPs unless `admincerts`
#    are managed manually.
#
# 4. `orderer0` and `ordereradmin` are registered without the hierarchical
#    `orderer.department1` affiliation on purpose. Keeping that affiliation in
#    this local root-CA fallback path caused duplicated/invalid OU combinations
#    in the orderer certificate and later broke block validation on the peer.
#
# 5. The channel block generated here is consumed by channel participation on a
#    Fabric v2.5 runtime, so `configtx.yaml` must stay compatible with that
#    runtime even if this folder is named `fabric-v3`.
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

DATA_CHANNEL_NAME="${HLF_DATA_CHANNEL_NAME:-${HLF_CHANNEL_NAME:-health-care-local}}"
IDENTITY_CHANNEL_NAME="${HLF_IDENTITY_CHANNEL_NAME:-identity-local}"
BOOTSTRAP_CHANNELS_RAW="${HLF_BOOTSTRAP_CHANNELS:-${IDENTITY_CHANNEL_NAME},${DATA_CHANNEL_NAME}}"
SINGLE_HOST="${SINGLE_HOST:-true}"
HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"
HOST2_DOMAIN="${HOST2_DOMAIN:-host2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"
HOST1_MSP_ID="${HLF_MSP_ID_HOST1:-Host1MSP}"
HOST2_MSP_ID="${HLF_MSP_ID_HOST2:-Host2MSP}"
FABRIC_CA_CLIENT_CONTAINER="${FABRIC_CA_CLIENT_CONTAINER:-${GDC_CONTAINER_PREFIX:-gdc}-fabric-ca-client}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-${GDC_CONTAINER_PREFIX:-gdc}-fabric-tools}"

ROOT_CA_ADMIN_USER="${ROOT_CA_ADMIN_USER:-admin}"
ROOT_CA_ADMIN_PASS="${ROOT_CA_ADMIN_PASS:-adminpw}"
ICA_ADMIN_USER="${ICA_ADMIN_USER:-admin}"
ICA_ADMIN_PASS="${ICA_ADMIN_PASS:-adminpw}"

CA_HOST="${CA_HOST:-ica}"
CA_PORT="${CA_PORT:-7054}"
CA_TLS_CERT="${CA_TLS_CERT:-/workspace/crypto/ca/ica/ca-tls-bundle.pem}"
declare -a CHANNEL_NAMES=()

function exec_ca() {
  docker exec -w /workspace "${FABRIC_CA_CLIENT_CONTAINER}" "$@"
}

function exec_tools() {
  docker exec -w /workspace "${FABRIC_TOOLS_CONTAINER}" "$@"
}

function write_tls_server_chain() {
  local tls_dir="$1"

  # Fabric CA stores the self-signed root separately from the issuing ICA.
  # Present leaf + ICA to TLS clients and keep only the root as trust anchor.
  cat "${tls_dir}/signcerts/"*.pem > "${tls_dir}/server.crt"
  if compgen -G "${tls_dir}/tlsintermediatecerts/*.pem" >/dev/null; then
    cat "${tls_dir}/tlsintermediatecerts/"*.pem >> "${tls_dir}/server.crt"
  fi
  cp -f "${tls_dir}/tlscacerts/"*.pem "${tls_dir}/ca.crt"
}

# The ICA server trusts a full CA bundle for authenticated registry calls. The
# Fabric CA client consequently classifies the issuing ICA as a root in the
# generated MSP folders. Normalize those folders back to Fabric's required
# root + intermediate layout before a peer or orderer consumes them.
function normalize_enrolled_msp_trust() {
  local msp_dir="$1"
  [[ "${CA_HOST}" != "root-ca" ]] || return 0
  mkdir -p "${msp_dir}/cacerts" "${msp_dir}/intermediatecerts"
  rm -f "${msp_dir}/cacerts/"*.pem "${msp_dir}/intermediatecerts/"*.pem
  cp -f "${ROOT}/crypto/ca/root/ca-cert.pem" "${msp_dir}/cacerts/root-ca-cert.pem"
  cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "${msp_dir}/intermediatecerts/issuer-ca-cert.pem"
}

function normalize_enrolled_tls_trust() {
  local tls_dir="$1"
  [[ "${CA_HOST}" != "root-ca" ]] || return 0
  mkdir -p "${tls_dir}/tlscacerts" "${tls_dir}/tlsintermediatecerts"
  rm -f "${tls_dir}/tlscacerts/"*.pem "${tls_dir}/tlsintermediatecerts/"*.pem
  cp -f "${ROOT}/crypto/ca/root/ca-cert.pem" "${tls_dir}/tlscacerts/root-ca-cert.pem"
  cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "${tls_dir}/tlsintermediatecerts/issuer-ca-cert.pem"
}

function parse_channels() {
  local raw="$1"
  local normalized
  normalized="$(printf '%s' "${raw}" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d')"

  CHANNEL_NAMES=()
  while IFS= read -r channel_name; do
    [[ -n "${channel_name}" ]] || continue
    local seen=false
    for existing in "${CHANNEL_NAMES[@]-}"; do
      if [[ "${existing}" == "${channel_name}" ]]; then
        seen=true
        break
      fi
    done
    if [[ "${seen}" == "false" ]]; then
      CHANNEL_NAMES+=("${channel_name}")
    fi
  done <<< "${normalized}"

  if [[ ${#CHANNEL_NAMES[@]} -eq 0 ]]; then
    echo "No channels configured via HLF_BOOTSTRAP_CHANNELS/HLF_*_CHANNEL_NAME." >&2
    exit 1
  fi
}

function join_orderer_channel_if_needed() {
  local channel_name="$1"
  local output
  set +e
  output="$(
    exec_tools osnadmin channel join \
      --channelID "${channel_name}" \
      --config-block "/workspace/channel-artifacts/${channel_name}.block" \
      -o orderer:7053 \
      --ca-file "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt" \
      --client-cert "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/server.crt" \
      --client-key "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/server.key" \
      2>&1
  )"
  local status=$?
  set -e

  printf '%s\n' "${output}"

  if [[ ${status} -eq 0 ]] && printf '%s\n' "${output}" | grep -Eq '^Status: 2[0-9][0-9]$'; then
    return 0
  fi

  if printf '%s' "${output}" | grep -q 'cannot join: channel already exists'; then
    echo "Orderer channel ${channel_name} already active; continuing."
    return 0
  fi

  echo "unexpected response from orderer channel join" >&2
  return 1
}

function join_peer_channel_if_needed() {
  local channel_name="$1"
  local msp_id="$2"
  local admin_msp_path="$3"
  local peer_address="$4"
  local peer_tls_root="$5"

  local joined_channels=''
  set +e
  joined_channels="$(
    exec_tools env \
      CORE_PEER_LOCALMSPID="${msp_id}" \
      CORE_PEER_MSPCONFIGPATH="${admin_msp_path}" \
      CORE_PEER_ADDRESS="${peer_address}" \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE="${peer_tls_root}" \
      peer channel list 2>/dev/null
  )"
  set -e

  if printf '%s\n' "${joined_channels}" | grep -qx "${channel_name}"; then
    echo "Peer ${peer_address} already joined to ${channel_name}; continuing."
    return 0
  fi

  local output
  set +e
  output="$(
    exec_tools env \
      CORE_PEER_LOCALMSPID="${msp_id}" \
      CORE_PEER_MSPCONFIGPATH="${admin_msp_path}" \
      CORE_PEER_ADDRESS="${peer_address}" \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE="${peer_tls_root}" \
      peer channel join -b "/workspace/channel-artifacts/${channel_name}.block" 2>&1
  )"
  local status=$?
  set -e

  printf '%s\n' "${output}"

  if [[ ${status} -eq 0 ]]; then
    return 0
  fi

  if printf '%s' "${output}" | grep -q "ledger \\[${channel_name}\\] already exists with state \\[ACTIVE\\]"; then
    echo "Peer ${peer_address} already has ledger ${channel_name}; continuing."
    return 0
  fi

  return ${status}
}

function wait_for_peer() {
  local peer_address="$1"
  local msp_id="$2"
  local admin_msp_path="$3"
  local peer_tls_root="$4"

  for _attempt in $(seq 1 30); do
    if exec_tools env \
      CORE_PEER_LOCALMSPID="${msp_id}" \
      CORE_PEER_MSPCONFIGPATH="${admin_msp_path}" \
      CORE_PEER_ADDRESS="${peer_address}" \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE="${peer_tls_root}" \
      peer node status >/dev/null 2>&1; then
      echo "Peer ${peer_address} is ready."
      return 0
    fi
    sleep 2
  done

  echo "Peer ${peer_address} did not become ready." >&2
  return 1
}

function write_node_ou_config() {
  local msp_dir="$1"
  local ca_cert_rel="$2"

  cat > "${msp_dir}/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: ${ca_cert_rel}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: ${ca_cert_rel}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: ${ca_cert_rel}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: ${ca_cert_rel}
    OrganizationalUnitIdentifier: orderer
EOF
}

function write_enrolled_node_ou_config() {
  local msp_dir="$1"
  local ca_cert

  ca_cert="$(find "${msp_dir}/intermediatecerts" -maxdepth 1 -type f -name '*.pem' -print -quit 2>/dev/null || true)"
  if [[ -z "${ca_cert}" ]]; then
    ca_cert="$(find "${msp_dir}/cacerts" -maxdepth 1 -type f -name '*.pem' -print -quit)"
  fi
  write_node_ou_config "${msp_dir}" "${ca_cert#${msp_dir}/}"
}

mkdir -p organizations system-genesis-block channel-artifacts
parse_channels "${BOOTSTRAP_CHANNELS_RAW}"

# The intermediate CA runtime needs both its own certificate and the root chain
# when a Fabric client later authenticates both the server certificate and the
# enrollment certificate chain. Keeping the bundle in one file makes the client
# invocation deterministic and explicit.
cat "${ROOT}/crypto/ca/ica/ca-cert.pem" "${ROOT}/crypto/ca/ica/ca-chain.pem" > "${ROOT}/crypto/ca/ica/ca-tls-bundle.pem"

docker compose --profile ca up -d
docker compose --profile bootstrap up -d tools ca-client

echo "Waiting for CAs..."
sleep 3

# ---------------------------------------------------------------------------
# 1) Enroll ICA admin (to register identities)
# ---------------------------------------------------------------------------
rm -rf organizations/fabric-ca-client || true
mkdir -p organizations/fabric-ca-client/ica-admin

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" \
  --tls.certfiles "${CA_TLS_CERT}"

# ---------------------------------------------------------------------------
# 2) Create affiliations (dev)
# ---------------------------------------------------------------------------
# Historical note:
# these calls authenticate explicitly with `-u` instead of relying only on the
# previously enrolled admin home. The explicit URL makes local retries easier
# to reason about and avoids hidden differences between clean and dirty homes.
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add host1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add host1.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client affiliation add host2 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client affiliation add host2.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
fi
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add orderer -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add orderer.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true

# ---------------------------------------------------------------------------
# 3) Register identities (dev-only secrets)
# ---------------------------------------------------------------------------
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name host1admin --id.secret host1adminpw --id.type admin --id.affiliation host1.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name peer0host1 --id.secret peer0host1pw --id.type peer --id.affiliation host1.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true

if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client register --id.name host2admin --id.secret host2adminpw --id.type admin --id.affiliation host2.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client register --id.name peer0host2 --id.secret peer0host2pw --id.type peer --id.affiliation host2.department1 -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
fi

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name ordereradmin --id.secret ordereradminpw --id.type admin -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name orderer0 --id.secret orderer0pw --id.type orderer -u "https://${ICA_ADMIN_USER}:${ICA_ADMIN_PASS}@${CA_HOST}:${CA_PORT}" --tls.certfiles "${CA_TLS_CERT}" || true

# ---------------------------------------------------------------------------
# 4) Enroll MSP + TLS for orderer + peers + org admins
# ---------------------------------------------------------------------------
rm -rf organizations/peerOrganizations organizations/ordererOrganizations || true

# Org-level MSP folders (so configtxgen can load MSPDir)
#
# The local devnet currently aligns the org MSP trust roots with the `root-ca`
# fallback path used during local enrollment. That keeps the generated admin,
# peer and orderer identities verifiable by Fabric without requiring a second
# reconciliation step from the intermediate CA path.
function populate_org_msp_trust() {
  local msp_dir="$1"
  mkdir -p "${msp_dir}/cacerts" "${msp_dir}/tlscacerts" \
    "${msp_dir}/intermediatecerts" "${msp_dir}/tlsintermediatecerts"
  cp -f "${ROOT}/crypto/ca/root/ca-cert.pem" "${msp_dir}/cacerts/root-ca-cert.pem"
  cp -f "${ROOT}/crypto/ca/root/ca-cert.pem" "${msp_dir}/tlscacerts/root-ca-cert.pem"
  if [[ "${CA_HOST}" == "root-ca" ]]; then
    write_node_ou_config "${msp_dir}" "cacerts/root-ca-cert.pem"
  else
    cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "${msp_dir}/intermediatecerts/issuer-ca-cert.pem"
    cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "${msp_dir}/tlsintermediatecerts/issuer-ca-cert.pem"
    write_node_ou_config "${msp_dir}" "intermediatecerts/issuer-ca-cert.pem"
  fi
}

populate_org_msp_trust "organizations/peerOrganizations/${HOST1_DOMAIN}/msp"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  populate_org_msp_trust "organizations/peerOrganizations/${HOST2_DOMAIN}/msp"
fi

populate_org_msp_trust "organizations/ordererOrganizations/${ORDERER_DOMAIN}/msp"

# Orderer MSP + TLS
mkdir -p "organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://orderer0:orderer0pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/msp" \
  --csr.hosts orderer \
  --tls.certfiles "${CA_TLS_CERT}"
normalize_enrolled_msp_trust "organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/msp"
write_enrolled_node_ou_config "organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/msp"

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://orderer0:orderer0pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls" \
  --enrollment.profile tls \
  --csr.hosts orderer \
  --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"

ORDERER_TLS_DIR="organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls"
normalize_enrolled_tls_trust "${ORDERER_TLS_DIR}"
write_tls_server_chain "${ORDERER_TLS_DIR}"
cp -f "${ORDERER_TLS_DIR}/keystore/"*_sk "${ORDERER_TLS_DIR}/server.key" 2>/dev/null || cp -f "${ORDERER_TLS_DIR}/keystore/"* "${ORDERER_TLS_DIR}/server.key"

# Host1 peer MSP + TLS
mkdir -p "organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://peer0host1:peer0host1pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/msp" \
  --csr.hosts peer0-host1 \
  --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"
normalize_enrolled_msp_trust "organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/msp"
write_enrolled_node_ou_config "organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/msp"

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://peer0host1:peer0host1pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls" \
  --enrollment.profile tls \
  --csr.hosts peer0-host1 \
  --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"

PEER1_TLS_DIR="organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls"
normalize_enrolled_tls_trust "${PEER1_TLS_DIR}"
write_tls_server_chain "${PEER1_TLS_DIR}"
cp -f "${PEER1_TLS_DIR}/keystore/"*_sk "${PEER1_TLS_DIR}/server.key" 2>/dev/null || cp -f "${PEER1_TLS_DIR}/keystore/"* "${PEER1_TLS_DIR}/server.key"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  # Host2 peer MSP + TLS
  mkdir -p "organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}"
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client enroll \
    -u "https://peer0host2:peer0host2pw@${CA_HOST}:${CA_PORT}" \
    -M "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/msp" \
    --csr.hosts peer0-host2 \
    --csr.hosts localhost \
    --tls.certfiles "${CA_TLS_CERT}"
  normalize_enrolled_msp_trust "organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/msp"
  write_enrolled_node_ou_config "organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/msp"

  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client enroll \
    -u "https://peer0host2:peer0host2pw@${CA_HOST}:${CA_PORT}" \
    -M "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls" \
    --enrollment.profile tls \
    --csr.hosts peer0-host2 \
    --csr.hosts localhost \
    --tls.certfiles "${CA_TLS_CERT}"

  PEER2_TLS_DIR="organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls"
  normalize_enrolled_tls_trust "${PEER2_TLS_DIR}"
  write_tls_server_chain "${PEER2_TLS_DIR}"
  cp -f "${PEER2_TLS_DIR}/keystore/"*_sk "${PEER2_TLS_DIR}/server.key" 2>/dev/null || cp -f "${PEER2_TLS_DIR}/keystore/"* "${PEER2_TLS_DIR}/server.key"
fi

# Org admins (for peer channel operations)
mkdir -p "organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://host1admin:host1adminpw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp" \
  --tls.certfiles "${CA_TLS_CERT}"
normalize_enrolled_msp_trust "organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"
write_enrolled_node_ou_config "organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  mkdir -p "organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}"
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client enroll \
    -u "https://host2admin:host2adminpw@${CA_HOST}:${CA_PORT}" \
    -M "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp" \
    --tls.certfiles "${CA_TLS_CERT}"
  normalize_enrolled_msp_trust "organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp"
  write_enrolled_node_ou_config "organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp"
fi

# ---------------------------------------------------------------------------
# 5) Generate channel genesis block (Fabric v3 systemless flow)
# ---------------------------------------------------------------------------
# Even though this folder is named `fabric-v3`, the Docker runtime currently
# used in local development is Fabric v2.5.x. The configtx profile must stay
# compatible with that runtime, which is why the linked `configtx.yaml` uses
# v2-capabilities and explicit policies.
rm -rf channel-artifacts/* system-genesis-block/* || true

PROFILE_NAME="$( [[ "${SINGLE_HOST}" == "true" ]] && echo "GdcChannelSingleHost" || echo "GdcChannel" )"
for CHANNEL_NAME in "${CHANNEL_NAMES[@]}"; do
  exec_tools env FABRIC_CFG_PATH=/workspace/configtx \
    configtxgen -profile "${PROFILE_NAME}" -channelID "${CHANNEL_NAME}" \
    -outputBlock "/workspace/channel-artifacts/${CHANNEL_NAME}.block"
done

# ---------------------------------------------------------------------------
# 6) Start orderer + peers
# ---------------------------------------------------------------------------
if [[ "${SINGLE_HOST}" == "true" ]]; then
  docker compose --profile network-single up -d tools orderer peer0-host1
else
  docker compose --profile network-multi up -d tools orderer peer0-host1 peer0-host2
fi

echo "Waiting for orderer..."
sleep 3

wait_for_peer "peer0-host1:7051" \
  "${HOST1_MSP_ID}" \
  "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp" \
  "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  wait_for_peer "peer0-host2:7051" \
    "${HOST2_MSP_ID}" \
    "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp" \
    "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt"
fi

# ---------------------------------------------------------------------------
# 7) Join orderer to channel (channel participation API)
# ---------------------------------------------------------------------------
# The orderer admin endpoint requires mTLS. The Docker compose file therefore
# sets `ORDERER_ADMIN_TLS_CLIENTROOTCAS`, and this command intentionally uses
# the generated orderer TLS cert/key as the client certificate pair.
for CHANNEL_NAME in "${CHANNEL_NAMES[@]}"; do
  join_orderer_channel_if_needed "${CHANNEL_NAME}"
done

# ---------------------------------------------------------------------------
# 8) Join peers to channel
# ---------------------------------------------------------------------------
join_peer_channel_if_needed \
  "${CHANNEL_NAMES[0]}" \
  "${HOST1_MSP_ID}" \
  "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp" \
  "peer0-host1:7051" \
  "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"

for CHANNEL_NAME in "${CHANNEL_NAMES[@]:1}"; do
  join_peer_channel_if_needed \
    "${CHANNEL_NAME}" \
    "${HOST1_MSP_ID}" \
    "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp" \
    "peer0-host1:7051" \
    "/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"
done

if [[ "${SINGLE_HOST}" != "true" ]]; then
  for CHANNEL_NAME in "${CHANNEL_NAMES[@]}"; do
    join_peer_channel_if_needed \
      "${CHANNEL_NAME}" \
      "${HOST2_MSP_ID}" \
      "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp" \
      "peer0-host2:7051" \
      "/workspace/organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt"
  done
fi

echo "✅ Fabric devnet bootstrapped. Channels: ${CHANNEL_NAMES[*]}"
