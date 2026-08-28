#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

OUT="${ROOT}/.env.fabric-devnet"

CHANNEL_NAME="${HLF_DATA_CHANNEL_NAME:-${HLF_CHANNEL_NAME:-health-care-local}}"
IDENTITY_CHANNEL_NAME="${HLF_IDENTITY_CHANNEL_NAME:-identity-local}"
BOOTSTRAP_CHANNELS="${HLF_BOOTSTRAP_CHANNELS:-${IDENTITY_CHANNEL_NAME},${CHANNEL_NAME}}"
CHAINCODE_NAME="${HLF_CHAINCODE_NAME:-basic}"
SINGLE_HOST="${SINGLE_HOST:-true}"

HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"
HOST2_DOMAIN="${HOST2_DOMAIN:-host2.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"

HOST1_MSP="${HLF_MSP_ID_HOST1:-Host1MSP}"
HOST2_MSP="${HLF_MSP_ID_HOST2:-Host2MSP}"

function to_env_one_line_pem() {
  # Convert newlines to \n to keep dotenv compatible.
  perl -0pe 's/\n/\\n/g' "$1"
}

HOST1_ADMIN_CERT="organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp/signcerts/cert.pem"
HOST1_ADMIN_KEY="$(ls -1 organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp/keystore/* | head -n 1)"
HOST1_PEER_TLS_CA="organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"

HOST2_ADMIN_CERT="organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp/signcerts/cert.pem"
HOST2_PEER_TLS_CA="organizations/peerOrganizations/${HOST2_DOMAIN}/peers/peer0.${HOST2_DOMAIN}/tls/ca.crt"

if [[ ! -f "${HOST1_ADMIN_CERT}" || ! -f "${HOST1_ADMIN_KEY}" || ! -f "${HOST1_PEER_TLS_CA}" ]]; then
  echo "Missing Host1 MSP material. Run ./scripts/02-bootstrap-network.sh first."
  exit 1
fi

HOST2_BLOCK=""
if [[ "${SINGLE_HOST}" != "true" ]]; then
  HOST2_ADMIN_KEY="$(ls -1 organizations/peerOrganizations/${HOST2_DOMAIN}/users/Admin@${HOST2_DOMAIN}/msp/keystore/* | head -n 1)"
  if [[ ! -f "${HOST2_ADMIN_CERT}" || ! -f "${HOST2_ADMIN_KEY}" || ! -f "${HOST2_PEER_TLS_CA}" ]]; then
    echo "Missing Host2 MSP material. Run ./scripts/02-bootstrap-network.sh first."
    exit 1
  fi
  HOST2_BLOCK=$(
    cat <<EOF

# Host2 (optional, multi-host)
HLF_MSP_ID_HOST2=${HOST2_MSP}
HLF_CONNECTION_PEER_${HOST2_MSP}=localhost:9051
HLF_CONNECTION_PEM_${HOST2_MSP}=$(to_env_one_line_pem "${HOST2_PEER_TLS_CA}")
HLF_CERTIFICATE_${HOST2_MSP}=$(to_env_one_line_pem "${HOST2_ADMIN_CERT}")
HLF_PRIVATE_KEY_${HOST2_MSP}=$(to_env_one_line_pem "${HOST2_ADMIN_KEY}")
EOF
  )
fi

cat > "${OUT}" <<EOF
# Fabric devnet env (generated)
AS_LOCAL_HOST=true

HLF_CHANNEL_NAME=${CHANNEL_NAME}
HLF_DATA_CHANNEL_NAME=${CHANNEL_NAME}
HLF_IDENTITY_CHANNEL_NAME=${IDENTITY_CHANNEL_NAME}
HLF_BOOTSTRAP_CHANNELS=${BOOTSTRAP_CHANNELS}
HLF_CHAINCODE_NAME=${CHAINCODE_NAME}

# Host1 (host/dev). Tenants remain VAT-addressed business organizations and
# do not receive Fabric MSP identities merely because this host stores them.
HLF_MSP_ID_HOST1=${HOST1_MSP}
HLF_CONNECTION_PEER_${HOST1_MSP}=localhost:7051
HLF_CONNECTION_PEM_${HOST1_MSP}=$(to_env_one_line_pem "${HOST1_PEER_TLS_CA}")
HLF_CERTIFICATE_${HOST1_MSP}=$(to_env_one_line_pem "${HOST1_ADMIN_CERT}")
HLF_PRIVATE_KEY_${HOST1_MSP}=$(to_env_one_line_pem "${HOST1_ADMIN_KEY}")

${HOST2_BLOCK}
EOF

echo "Wrote ${OUT}"
