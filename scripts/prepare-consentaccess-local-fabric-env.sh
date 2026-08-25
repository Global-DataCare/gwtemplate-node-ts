#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVNET_ROOT="${ROOT}/../fabric-multicloud/devnet/fabric-v3"
BASE_ENV="${ROOT}/.env.local-demo"
OUT_ENV="${ROOT}/.env.local-fabric"
LEGACY_OUT_ENV="${ROOT}/.env.local-fabric-devnet"
DEVNET_ENV="${DEVNET_ROOT}/.env.fabric-devnet"
ENSURE_DEVNET_ENV_SCRIPT="${ROOT}/scripts/ensure-fabric-devnet-env.sh"
HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"

CHANNEL_NAME="${CHANNEL_NAME:-health-care-local}"
CONSENT_CHAINCODE_NAME="${CONSENT_CHAINCODE_NAME:-consentaccess-sc}"
LEDGER_MSP_ID_VALUE="${LEDGER_MSP_ID_VALUE:-Host1MSP}"
HOST_JURISDICTION_VALUE="${HOST_JURISDICTION_VALUE:-eu}"
TENANT_JURISDICTION_VALUE="${TENANT_JURISDICTION_VALUE:-ES}"
SECTOR_VALUE="${SECTOR_VALUE:-health-care}"
NETWORK_MODE_VALUE="${NETWORK_MODE_VALUE:-local-network}"
IDENTITY_CHANNEL_NAME="${IDENTITY_CHANNEL_NAME:-identity-local}"
BOOTSTRAP_CHANNELS_VALUE="${BOOTSTRAP_CHANNELS_VALUE:-${IDENTITY_CHANNEL_NAME},${CHANNEL_NAME}}"
FABRIC_PEER_ENDPOINT_VALUE="${FABRIC_PEER_ENDPOINT_VALUE:-localhost:7051}"
LEGACY_REPRESENTATIVE_CONTROLLER_VALUE="${HOST_LEGACY_REPRESENTATIVE_CONTROLLER:-false}"
TENANT_SERVICE_ROUTES_JSON_VALUE="${TENANT_SERVICE_ROUTES_JSON:-}"

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

function to_env_one_line_pem() {
  perl -0pe 's/\n/\\n/g' "$1"
}

[[ -d "${DEVNET_ROOT}" ]] || fail "Missing devnet directory: ${DEVNET_ROOT}"
[[ -f "${BASE_ENV}" ]] || fail "Missing base env file: ${BASE_ENV}"
[[ -f "${ENSURE_DEVNET_ENV_SCRIPT}" ]] || fail "Missing helper script: ${ENSURE_DEVNET_ENV_SCRIPT}"

bash "${ENSURE_DEVNET_ENV_SCRIPT}"
[[ -f "${DEVNET_ENV}" ]] || fail "Missing devnet env file after generation: ${DEVNET_ENV}"

HOST1_ADMIN_CERT="${DEVNET_ROOT}/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp/signcerts/cert.pem"
HOST1_ADMIN_KEY="$(ls -1 "${DEVNET_ROOT}/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp/keystore/"* | head -n 1)"
HOST1_PEER_TLS_CA="${DEVNET_ROOT}/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"

[[ -f "${HOST1_ADMIN_CERT}" ]] || fail "Missing Host1 admin certificate: ${HOST1_ADMIN_CERT}"
[[ -f "${HOST1_ADMIN_KEY}" ]] || fail "Missing Host1 admin private key under keystore."
[[ -f "${HOST1_PEER_TLS_CA}" ]] || fail "Missing Host1 peer TLS CA certificate: ${HOST1_PEER_TLS_CA}"

sed '/^HLF_[A-Za-z0-9_]*=/d' "${BASE_ENV}" > "${OUT_ENV}"
awk '
  BEGIN { skip = 0 }
  /^HLF_/ { skip = 1; next }
  skip == 1 {
    if ($0 ~ /^[A-Z0-9_]+=|^#|^$/) { skip = 0 } else { next }
  }
  { print }
' "${DEVNET_ENV}" >> "${OUT_ENV}"
cat >> "${OUT_ENV}" <<EOF

# Added by scripts/prepare-consentaccess-local-fabric-env.sh
# These overrides must be appended after the devnet-generated Fabric env so they
# remain the final effective values.
#
# Important local rule:
# - local-network now exercises both the identity ledger and consent ledger
# - host/tenant onboarding writes go to identity-local
# - consent lifecycle writes go to health-care-local
NETWORK_MODE=${NETWORK_MODE_VALUE}
LEDGER_ENABLED=true
LEDGER_PROVIDER_DEFAULT=mem
LEDGER_PROVIDER_MAP=test=mem,local-network=fabric,test-network=fabric,network=fabric
LEDGER_MSP_ID=${LEDGER_MSP_ID_VALUE}
LEDGER_FABRIC_MSP_ID=${LEDGER_MSP_ID_VALUE}
LEDGER_FABRIC_ITEM_TYPE=credential
LEDGER_ORG_CHAINCODE=organization-sc
LEDGER_CRYPTOGRAPHIC_KEY_CHAINCODE=cryptographickey-sc
LEDGER_SUBJECT_KEY_BINDING_CHAINCODE=subjectkeybinding-sc
LEDGER_ARTIFACT_CHAINCODE=artifact-sc
LEDGER_ARTIFACT_EVENT_CHAINCODE=artifactevent-sc
LEDGER_EVIDENCE_CHAINCODE=evidence-sc
LEDGER_IDENTITY_CHANNEL_DEFAULT=${IDENTITY_CHANNEL_NAME}
AS_LOCAL_HOST=true
HLF_DATA_CHANNEL_NAME=${CHANNEL_NAME}
HLF_IDENTITY_CHANNEL_NAME=${IDENTITY_CHANNEL_NAME}
HLF_BOOTSTRAP_CHANNELS=${BOOTSTRAP_CHANNELS_VALUE}
HLF_MSP_ID_HOST1=${LEDGER_MSP_ID_VALUE}
HLF_CONNECTION_PEER=${FABRIC_PEER_ENDPOINT_VALUE}
HLF_CONNECTION_PEM=$(to_env_one_line_pem "${HOST1_PEER_TLS_CA}")
HLF_CERTIFICATE=$(to_env_one_line_pem "${HOST1_ADMIN_CERT}")
HLF_PRIVATE_KEY=$(to_env_one_line_pem "${HOST1_ADMIN_KEY}")
CONSENT_ACCESS_LEDGER_CHAINCODE=${CONSENT_CHAINCODE_NAME}
FHIR_VERSION_LEDGER_CHAINCODE=fhir-versioning
HLF_CHANNEL_NAME=${CHANNEL_NAME}
HOST_JURISDICTION=${HOST_JURISDICTION_VALUE}
JURISDICTION=${TENANT_JURISDICTION_VALUE}
DEFAULT_SECTOR=${SECTOR_VALUE}
HOST_LEGACY_REPRESENTATIVE_CONTROLLER=${LEGACY_REPRESENTATIVE_CONTROLLER_VALUE}
TENANT_SERVICE_ROUTES_JSON=${TENANT_SERVICE_ROUTES_JSON_VALUE}
EOF

cat <<EOF
Wrote ${OUT_ENV}

Consent access local Fabric env:
  healthcare channel: ${CHANNEL_NAME}
  identity channel:   ${IDENTITY_CHANNEL_NAME}
  bootstrap channels: ${BOOTSTRAP_CHANNELS_VALUE}
  sector:     ${SECTOR_VALUE}
  host jurisdiction:${HOST_JURISDICTION_VALUE}
  tenant jurisdiction:${TENANT_JURISDICTION_VALUE}
  mspId:      ${LEDGER_MSP_ID_VALUE}
  chaincode:  ${CONSENT_CHAINCODE_NAME}
  peer:       ${FABRIC_PEER_ENDPOINT_VALUE}
  legacy representative controller: ${LEGACY_REPRESENTATIVE_CONTROLLER_VALUE}
  tenant service routes configured: $([[ -n "${TENANT_SERVICE_ROUTES_JSON_VALUE}" ]] && printf yes || printf no)

Run GW CORE with:
  cd ${ROOT}
  npm run api:local-fabric
EOF

cp "${OUT_ENV}" "${LEGACY_OUT_ENV}"
printf 'Wrote compatibility alias %s\n' "${LEGACY_OUT_ENV}"
