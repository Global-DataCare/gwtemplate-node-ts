#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

OUT="${ROOT}/.env.fabric-devnet"

CHANNEL_NAME="${HLF_CHANNEL_NAME:-mychannel}"
CHAINCODE_NAME="${HLF_CHAINCODE_NAME:-basic}"
SINGLE_HOST="${SINGLE_HOST:-true}"

ORG1_DOMAIN="${ORG1_DOMAIN:-org1.example.com}"
ORG2_DOMAIN="${ORG2_DOMAIN:-org2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"

ORG1_MSP="${HLF_MSP_ID_ORG1:-Org1MSP}"
ORG2_MSP="${HLF_MSP_ID_ORG2:-Org2MSP}"

function to_env_one_line_pem() {
  # Convert newlines to \n to keep dotenv compatible.
  sed ':a;N;$!ba;s/\n/\\n/g' "$1"
}

ORG1_ADMIN_CERT="organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp/signcerts/cert.pem"
ORG1_ADMIN_KEY="$(ls -1 organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp/keystore/* | head -n 1)"
ORG1_PEER_TLS_CA="organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"

ORG2_ADMIN_CERT="organizations/peerOrganizations/${ORG2_DOMAIN}/users/Admin@${ORG2_DOMAIN}/msp/signcerts/cert.pem"
ORG2_PEER_TLS_CA="organizations/peerOrganizations/${ORG2_DOMAIN}/peers/peer0.${ORG2_DOMAIN}/tls/ca.crt"

if [[ ! -f "${ORG1_ADMIN_CERT}" || ! -f "${ORG1_ADMIN_KEY}" || ! -f "${ORG1_PEER_TLS_CA}" ]]; then
  echo "Missing Org1 MSP material. Run ./scripts/02-bootstrap-network.sh first."
  exit 1
fi

ORG2_BLOCK=""
if [[ "${SINGLE_HOST}" != "true" ]]; then
  ORG2_ADMIN_KEY="$(ls -1 organizations/peerOrganizations/${ORG2_DOMAIN}/users/Admin@${ORG2_DOMAIN}/msp/keystore/* | head -n 1)"
  if [[ ! -f "${ORG2_ADMIN_CERT}" || ! -f "${ORG2_ADMIN_KEY}" || ! -f "${ORG2_PEER_TLS_CA}" ]]; then
    echo "Missing Org2 MSP material. Run ./scripts/02-bootstrap-network.sh first."
    exit 1
  fi
  ORG2_BLOCK=$(
    cat <<EOF

# Org2 (optional, multi-org)
HLF_MSP_ID_ORG2=${ORG2_MSP}
HLF_CONNECTION_PEER_${ORG2_MSP}=localhost:9051
HLF_CONNECTION_PEM_${ORG2_MSP}=$(to_env_one_line_pem "${ORG2_PEER_TLS_CA}")
HLF_CERTIFICATE_${ORG2_MSP}=$(to_env_one_line_pem "${ORG2_ADMIN_CERT}")
HLF_PRIVATE_KEY_${ORG2_MSP}=$(to_env_one_line_pem "${ORG2_ADMIN_KEY}")
EOF
  )
fi

cat > "${OUT}" <<EOF
# Fabric devnet env (generated)
AS_LOCAL_HOST=true

HLF_CHANNEL_NAME=${CHANNEL_NAME}
HLF_CHAINCODE_NAME=${CHAINCODE_NAME}

# Org1 (host/dev)
HLF_MSP_ID_ORG1=${ORG1_MSP}
HLF_CONNECTION_PEER_${ORG1_MSP}=localhost:7051
HLF_CONNECTION_PEM_${ORG1_MSP}=$(to_env_one_line_pem "${ORG1_PEER_TLS_CA}")
HLF_CERTIFICATE_${ORG1_MSP}=$(to_env_one_line_pem "${ORG1_ADMIN_CERT}")
HLF_PRIVATE_KEY_${ORG1_MSP}=$(to_env_one_line_pem "${ORG1_ADMIN_KEY}")

${ORG2_BLOCK}
EOF

echo "Wrote ${OUT}"
