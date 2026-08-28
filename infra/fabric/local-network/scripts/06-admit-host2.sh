#!/usr/bin/env bash
# Dynamically admits Host2MSP to channels that were bootstrapped with Host1MSP
# only. This is disposable local-network evidence of the governed config-update
# boundary; production executes equivalent operations through the reconciler.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

CHANNELS_RAW="${HLF_BOOTSTRAP_CHANNELS:-identity-local,health-care-local}"
HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"
HOST2_DOMAIN="${HOST2_DOMAIN:-host2.example.com}"
HOST1_MSP_ID="${HLF_MSP_ID_HOST1:-Host1MSP}"
HOST2_MSP_ID="${HLF_MSP_ID_HOST2:-Host2MSP}"
PREFIX="${GDC_CONTAINER_PREFIX:-gdc}"
CA_CLIENT="${FABRIC_CA_CLIENT_CONTAINER:-${PREFIX}-fabric-ca-client}"
TOOLS="${FABRIC_TOOLS_CONTAINER:-${PREFIX}-fabric-tools}"
CA_URL="https://admin:adminpw@ica:7054"
CA_TLS_CERT="/workspace/crypto/ca/ica/ca-tls-bundle.pem"
HOST1_ADMIN="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"
HOST1_TLS_ROOT="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"
ORDERER_TLS_ROOT="/workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt"
HOST2_ROOT="organizations/peerOrganizations/${HOST2_DOMAIN}"

exec_ca() { docker exec -w /workspace "${CA_CLIENT}" "$@"; }
exec_tools() { docker exec -w /workspace "${TOOLS}" "$@"; }

write_node_ous() {
  local msp_dir="$1"
  cat > "${msp_dir}/config.yaml" <<'YAML'
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: intermediatecerts/issuer-ca-cert.pem
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: intermediatecerts/issuer-ca-cert.pem
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: intermediatecerts/issuer-ca-cert.pem
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: intermediatecerts/issuer-ca-cert.pem
    OrganizationalUnitIdentifier: orderer
YAML
}

normalize_msp() {
  local msp_dir="$1"
  mkdir -p "${msp_dir}/cacerts" "${msp_dir}/intermediatecerts"
  rm -f "${msp_dir}/cacerts/"*.pem "${msp_dir}/intermediatecerts/"*.pem
  cp crypto/ca/root/ca-cert.pem "${msp_dir}/cacerts/root-ca-cert.pem"
  cp crypto/ca/ica/ca-cert.pem "${msp_dir}/intermediatecerts/issuer-ca-cert.pem"
  write_node_ous "${msp_dir}"
}

normalize_tls() {
  local tls_dir="$1"
  mkdir -p "${tls_dir}/tlscacerts" "${tls_dir}/tlsintermediatecerts"
  rm -f "${tls_dir}/tlscacerts/"*.pem "${tls_dir}/tlsintermediatecerts/"*.pem
  cp crypto/ca/root/ca-cert.pem "${tls_dir}/tlscacerts/root-ca-cert.pem"
  cp crypto/ca/ica/ca-cert.pem "${tls_dir}/tlsintermediatecerts/issuer-ca-cert.pem"
  cat "${tls_dir}/signcerts/"*.pem crypto/ca/ica/ca-cert.pem > "${tls_dir}/server.crt"
  cp crypto/ca/root/ca-cert.pem "${tls_dir}/ca.crt"
  cp "$(find "${tls_dir}/keystore" -maxdepth 1 -type f -print -quit)" "${tls_dir}/server.key"
}

docker ps --format '{{.Names}}' | grep -qx "${PREFIX}-peer0-host1" || {
  echo 'Host1 peer must be running before dynamic admission.' >&2
  exit 2
}
docker ps --format '{{.Names}}' | grep -qx "${PREFIX}-ica" || {
  echo 'Fabric ICA must be running before dynamic admission.' >&2
  exit 2
}
[[ ! -d "${HOST2_ROOT}" ]] || {
  echo 'Host2 identity already exists; refusing to overwrite it.' >&2
  exit 2
}

exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add host2 -u "${CA_URL}" --tls.certfiles "${CA_TLS_CERT}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client affiliation add host2.department1 -u "${CA_URL}" --tls.certfiles "${CA_TLS_CERT}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name host2admin --id.secret host2adminpw \
  --id.type admin --id.affiliation host2.department1 -u "${CA_URL}" --tls.certfiles "${CA_TLS_CERT}"
exec_ca env FABRIC_CA_CLIENT_HOME=/workspace/organizations/fabric-ca-client/ica-admin \
  fabric-ca-client register --id.name peer0host2 --id.secret peer0host2pw \
  --id.type peer --id.affiliation host2.department1 -u "${CA_URL}" --tls.certfiles "${CA_TLS_CERT}"

mkdir -p "${HOST2_ROOT}/msp" "${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}" \
  "${HOST2_ROOT}/users/Admin@${HOST2_DOMAIN}"
normalize_msp "${HOST2_ROOT}/msp"

exec_ca fabric-ca-client enroll \
  -u 'https://peer0host2:peer0host2pw@ica:7054' \
  -M "/workspace/${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}/msp" \
  --csr.hosts peer0-host2 --csr.hosts localhost --tls.certfiles "${CA_TLS_CERT}"
normalize_msp "${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}/msp"

exec_ca fabric-ca-client enroll \
  -u 'https://peer0host2:peer0host2pw@ica:7054' \
  -M "/workspace/${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}/tls" \
  --enrollment.profile tls --csr.hosts peer0-host2 --csr.hosts localhost \
  --tls.certfiles "${CA_TLS_CERT}"
normalize_tls "${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}/tls"

exec_ca fabric-ca-client enroll \
  -u 'https://host2admin:host2adminpw@ica:7054' \
  -M "/workspace/${HOST2_ROOT}/users/Admin@${HOST2_DOMAIN}/msp" \
  --tls.certfiles "${CA_TLS_CERT}"
normalize_msp "${HOST2_ROOT}/users/Admin@${HOST2_DOMAIN}/msp"

exec_tools env FABRIC_CFG_PATH=/workspace/configtx \
  configtxgen -printOrg "${HOST2_MSP_ID}" > channel-artifacts/host2-org.json

IFS=',' read -r -a channels <<< "${CHANNELS_RAW}"
for channel in "${channels[@]}"; do
  channel="$(printf '%s' "${channel}" | xargs)"
  [[ -n "${channel}" ]] || continue
  work="/workspace/channel-artifacts/admit-host2-${channel}"
  rm -rf "channel-artifacts/admit-host2-${channel}"
  mkdir -p "channel-artifacts/admit-host2-${channel}"

  exec_tools env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN}" CORE_PEER_ADDRESS=peer0-host1:7051 \
    CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_TLS_ROOT}" \
    peer channel fetch config "${work}/config-block.pb" -o orderer:7050 \
    --ordererTLSHostnameOverride orderer -c "${channel}" --tls --cafile "${ORDERER_TLS_ROOT}"
  exec_tools configtxlator proto_decode --input "${work}/config-block.pb" \
    --type common.Block --output "${work}/config-block.json"
  exec_tools sh -c "jq '.data.data[0].payload.data.config' '${work}/config-block.json' > '${work}/config.json'"
  exec_tools sh -c "jq -s '.[0] * {\"channel_group\":{\"groups\":{\"Application\":{\"groups\":{\"${HOST2_MSP_ID}\":.[1]}}}}}' '${work}/config.json' /workspace/channel-artifacts/host2-org.json > '${work}/modified.json'"
  exec_tools configtxlator proto_encode --input "${work}/config.json" \
    --type common.Config --output "${work}/config.pb"
  exec_tools configtxlator proto_encode --input "${work}/modified.json" \
    --type common.Config --output "${work}/modified.pb"
  exec_tools configtxlator compute_update --channel_id "${channel}" \
    --original "${work}/config.pb" --updated "${work}/modified.pb" \
    --output "${work}/update.pb"
  exec_tools configtxlator proto_decode --input "${work}/update.pb" \
    --type common.ConfigUpdate --output "${work}/update.json"
  exec_tools sh -c "jq -n --arg channel '${channel}' --slurpfile update '${work}/update.json' '{payload:{header:{channel_header:{channel_id:\$channel,type:2}},data:{config_update:\$update[0]}}}' > '${work}/envelope.json'"
  exec_tools configtxlator proto_encode --input "${work}/envelope.json" \
    --type common.Envelope --output "${work}/envelope.pb"
  exec_tools env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN}" CORE_PEER_ADDRESS=peer0-host1:7051 \
    CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_TLS_ROOT}" \
    peer channel update -f "${work}/envelope.pb" -c "${channel}" -o orderer:7050 \
    --ordererTLSHostnameOverride orderer --tls --cafile "${ORDERER_TLS_ROOT}"
done

docker compose --profile network-multi up -d peer0-host2
for _ in $(seq 1 30); do
  if exec_tools env CORE_PEER_LOCALMSPID="${HOST2_MSP_ID}" \
    CORE_PEER_MSPCONFIGPATH="/workspace/${HOST2_ROOT}/users/Admin@${HOST2_DOMAIN}/msp" \
    CORE_PEER_ADDRESS=peer0-host2:7051 CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="/workspace/${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt" \
    peer node status >/dev/null 2>&1; then break; fi
  sleep 2
done

for channel in "${channels[@]}"; do
  channel="$(printf '%s' "${channel}" | xargs)"
  block="/workspace/channel-artifacts/${channel}-host2.block"
  exec_tools env CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN}" CORE_PEER_ADDRESS=peer0-host1:7051 \
    CORE_PEER_TLS_ENABLED=true CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_TLS_ROOT}" \
    peer channel fetch 0 "${block}" -o orderer:7050 --ordererTLSHostnameOverride orderer \
    -c "${channel}" --tls --cafile "${ORDERER_TLS_ROOT}"
  exec_tools env CORE_PEER_LOCALMSPID="${HOST2_MSP_ID}" \
    CORE_PEER_MSPCONFIGPATH="/workspace/${HOST2_ROOT}/users/Admin@${HOST2_DOMAIN}/msp" \
    CORE_PEER_ADDRESS=peer0-host2:7051 CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="/workspace/${HOST2_ROOT}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt" \
    peer channel join -b "${block}"
done

echo "Host2MSP dynamically admitted to: ${channels[*]}"
