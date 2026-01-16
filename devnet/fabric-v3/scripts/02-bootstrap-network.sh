#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

CHANNEL_NAME="${HLF_CHANNEL_NAME:-mychannel}"
SINGLE_HOST="${SINGLE_HOST:-true}"
ORG1_DOMAIN="${ORG1_DOMAIN:-org1.example.com}"
ORG2_DOMAIN="${ORG2_DOMAIN:-org2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"

ROOT_CA_ADMIN_USER="${ROOT_CA_ADMIN_USER:-admin}"
ROOT_CA_ADMIN_PASS="${ROOT_CA_ADMIN_PASS:-adminpw}"
ICA_ADMIN_USER="${ICA_ADMIN_USER:-admin}"
ICA_ADMIN_PASS="${ICA_ADMIN_PASS:-adminpw}"

CA_HOST="${CA_HOST:-ica}"
CA_PORT="${CA_PORT:-7054}"
CA_TLS_CERT="/workspace/crypto/ca/ica/ca-cert.pem"

function exec_ca() {
  docker exec -w /workspace gdc-fabric-ca-client "$@"
}

function exec_tools() {
  docker exec -w /workspace gdc-fabric-tools "$@"
}

mkdir -p organizations system-genesis-block channel-artifacts

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
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add org1 || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add org1.department1 || true
if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client affiliation add org2 || true
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client affiliation add org2.department1 || true
fi
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add orderer || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add orderer.department1 || true

# ---------------------------------------------------------------------------
# 3) Register identities (dev-only secrets)
# ---------------------------------------------------------------------------
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name org1admin --id.secret org1adminpw --id.type admin --id.affiliation org1.department1 || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name peer0org1 --id.secret peer0org1pw --id.type peer --id.affiliation org1.department1 || true

if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client register --id.name org2admin --id.secret org2adminpw --id.type admin --id.affiliation org2.department1 || true
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client register --id.name peer0org2 --id.secret peer0org2pw --id.type peer --id.affiliation org2.department1 || true
fi

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name ordereradmin --id.secret ordereradminpw --id.type admin --id.affiliation orderer.department1 || true
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name orderer0 --id.secret orderer0pw --id.type orderer --id.affiliation orderer.department1 || true

# ---------------------------------------------------------------------------
# 4) Enroll MSP + TLS for orderer + peers + org admins
# ---------------------------------------------------------------------------
rm -rf organizations/peerOrganizations organizations/ordererOrganizations || true

# Org-level MSP folders (so configtxgen can load MSPDir)
mkdir -p "organizations/peerOrganizations/${ORG1_DOMAIN}/msp/cacerts"
mkdir -p "organizations/peerOrganizations/${ORG1_DOMAIN}/msp/tlscacerts"
cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "organizations/peerOrganizations/${ORG1_DOMAIN}/msp/cacerts/ica-ca-cert.pem"
cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "organizations/peerOrganizations/${ORG1_DOMAIN}/msp/tlscacerts/ica-ca-cert.pem"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  mkdir -p "organizations/peerOrganizations/${ORG2_DOMAIN}/msp/cacerts"
  mkdir -p "organizations/peerOrganizations/${ORG2_DOMAIN}/msp/tlscacerts"
  cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "organizations/peerOrganizations/${ORG2_DOMAIN}/msp/cacerts/ica-ca-cert.pem"
  cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "organizations/peerOrganizations/${ORG2_DOMAIN}/msp/tlscacerts/ica-ca-cert.pem"
fi

mkdir -p "organizations/ordererOrganizations/${ORDERER_DOMAIN}/msp/cacerts"
mkdir -p "organizations/ordererOrganizations/${ORDERER_DOMAIN}/msp/tlscacerts"
cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "organizations/ordererOrganizations/${ORDERER_DOMAIN}/msp/cacerts/ica-ca-cert.pem"
cp -f "${ROOT}/crypto/ca/ica/ca-cert.pem" "organizations/ordererOrganizations/${ORDERER_DOMAIN}/msp/tlscacerts/ica-ca-cert.pem"

# Orderer MSP + TLS
mkdir -p "organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://orderer0:orderer0pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/msp" \
  --csr.hosts orderer \
  --tls.certfiles "${CA_TLS_CERT}"

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://orderer0:orderer0pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls" \
  --enrollment.profile tls \
  --csr.hosts orderer \
  --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"

ORDERER_TLS_DIR="organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls"
cp -f "${ORDERER_TLS_DIR}/signcerts/"*.pem "${ORDERER_TLS_DIR}/server.crt"
cp -f "${ORDERER_TLS_DIR}/keystore/"*_sk "${ORDERER_TLS_DIR}/server.key" 2>/dev/null || cp -f "${ORDERER_TLS_DIR}/keystore/"* "${ORDERER_TLS_DIR}/server.key"
cp -f "${ORDERER_TLS_DIR}/tlscacerts/"*.pem "${ORDERER_TLS_DIR}/ca.crt"

# Org1 peer MSP + TLS
mkdir -p "organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://peer0org1:peer0org1pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/msp" \
  --csr.hosts peer0-org1 \
  --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://peer0org1:peer0org1pw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls" \
  --enrollment.profile tls \
  --csr.hosts peer0-org1 \
  --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"

PEER1_TLS_DIR="organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls"
cp -f "${PEER1_TLS_DIR}/signcerts/"*.pem "${PEER1_TLS_DIR}/server.crt"
cp -f "${PEER1_TLS_DIR}/keystore/"*_sk "${PEER1_TLS_DIR}/server.key" 2>/dev/null || cp -f "${PEER1_TLS_DIR}/keystore/"* "${PEER1_TLS_DIR}/server.key"
cp -f "${PEER1_TLS_DIR}/tlscacerts/"*.pem "${PEER1_TLS_DIR}/ca.crt"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  # Org2 peer MSP + TLS
  mkdir -p "organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}"
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client enroll \
    -u "https://peer0org2:peer0org2pw@${CA_HOST}:${CA_PORT}" \
    -M "/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}/msp" \
    --csr.hosts peer0-org2 \
    --csr.hosts localhost \
    --tls.certfiles "${CA_TLS_CERT}"

  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client enroll \
    -u "https://peer0org2:peer0org2pw@${CA_HOST}:${CA_PORT}" \
    -M "/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}/tls" \
    --enrollment.profile tls \
    --csr.hosts peer0-org2 \
    --csr.hosts localhost \
    --tls.certfiles "${CA_TLS_CERT}"

  PEER2_TLS_DIR="organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}/tls"
  cp -f "${PEER2_TLS_DIR}/signcerts/"*.pem "${PEER2_TLS_DIR}/server.crt"
  cp -f "${PEER2_TLS_DIR}/keystore/"*_sk "${PEER2_TLS_DIR}/server.key" 2>/dev/null || cp -f "${PEER2_TLS_DIR}/keystore/"* "${PEER2_TLS_DIR}/server.key"
  cp -f "${PEER2_TLS_DIR}/tlscacerts/"*.pem "${PEER2_TLS_DIR}/ca.crt"
fi

# Org admins (for peer channel operations)
mkdir -p "organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client enroll \
  -u "https://org1admin:org1adminpw@${CA_HOST}:${CA_PORT}" \
  -M "/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp" \
  --tls.certfiles "${CA_TLS_CERT}"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  mkdir -p "organizations/peerOrganizations/${ORG2_DOMAIN}/users/Admin@${ORG2_DOMAIN}"
  exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
    fabric-ca-client enroll \
    -u "https://org2admin:org2adminpw@${CA_HOST}:${CA_PORT}" \
    -M "/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/users/Admin@${ORG2_DOMAIN}/msp" \
    --tls.certfiles "${CA_TLS_CERT}"
fi

# ---------------------------------------------------------------------------
# 5) Generate channel genesis block (Fabric v3 systemless flow)
# ---------------------------------------------------------------------------
rm -rf channel-artifacts/* system-genesis-block/* || true

exec_tools env FABRIC_CFG_PATH=/workspace/configtx \
  configtxgen -profile $( [[ "${SINGLE_HOST}" == "true" ]] && echo "GdcChannelSingleHost" || echo "GdcChannel" ) -channelID "${CHANNEL_NAME}" \
  -outputBlock "/workspace/channel-artifacts/${CHANNEL_NAME}.block"

# ---------------------------------------------------------------------------
# 6) Start orderer + peers
# ---------------------------------------------------------------------------
if [[ "${SINGLE_HOST}" == "true" ]]; then
  docker compose --profile network-single up -d tools orderer peer0-org1
else
  docker compose --profile network-multi up -d tools orderer peer0-org1 peer0-org2
fi

echo "Waiting for orderer..."
sleep 3

# ---------------------------------------------------------------------------
# 7) Join orderer to channel (channel participation API)
# ---------------------------------------------------------------------------
exec_tools osnadmin channel join \
  --channelID "${CHANNEL_NAME}" \
  --config-block "/workspace/channel-artifacts/${CHANNEL_NAME}.block" \
  -o orderer:7053 \
  --ca-file "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt" \
  --client-cert "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/server.crt" \
  --client-key "/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/server.key"

# ---------------------------------------------------------------------------
# 8) Join peers to channel
# ---------------------------------------------------------------------------
exec_tools env \
  CORE_PEER_LOCALMSPID=Org1MSP \
  CORE_PEER_MSPCONFIGPATH="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp" \
  CORE_PEER_ADDRESS=peer0-org1:7051 \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt" \
  peer channel join -b "/workspace/channel-artifacts/${CHANNEL_NAME}.block"

if [[ "${SINGLE_HOST}" != "true" ]]; then
  exec_tools env \
    CORE_PEER_LOCALMSPID=Org2MSP \
    CORE_PEER_MSPCONFIGPATH="/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/users/Admin@${ORG2_DOMAIN}/msp" \
    CORE_PEER_ADDRESS=peer0-org2:7051 \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="/workspace/organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}/tls/ca.crt" \
    peer channel join -b "/workspace/channel-artifacts/${CHANNEL_NAME}.block"
fi

echo "✅ Fabric devnet bootstrapped. Channel: ${CHANNEL_NAME}"
