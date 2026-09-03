#!/usr/bin/env bash
# Flow contract:
# 1. the authority registers a one-use Fabric client identity bound to the authorized Host VC;
# 2. an approved handoff window may last up to 72 hours without increasing that one-use limit;
# 3. the host generates the GW client private key locally and receives its certificate;
# 4. a mode-0600 dotenv file points GW at its own MSP peer without copying either grant.
# Authorization invariant: client MSP, host URL, network and Host VC identifier come from authorization.json.
# Persistence invariant: the resulting client MSP and dotenv survive pod replacement through host-owned Secret custody.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/bin" "${WORK}/ca-admin"

cat > "${WORK}/bin/fabric-ca-client" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_CA_CALLS}"
if [[ "${1:-}" == "enroll" ]]; then
  mkdir -p "${FABRIC_CA_CLIENT_HOME}/msp/signcerts" "${FABRIC_CA_CLIENT_HOME}/msp/keystore"
  printf '%s\n' '-----BEGIN CERTIFICATE-----' 'client-certificate' '-----END CERTIFICATE-----' \
    > "${FABRIC_CA_CLIENT_HOME}/msp/signcerts/cert.pem"
  printf '%s\n' '-----BEGIN PRIVATE KEY-----' 'client-private-key' '-----END PRIVATE KEY-----' \
    > "${FABRIC_CA_CLIENT_HOME}/msp/keystore/key.pem"
fi
SCRIPT
chmod +x "${WORK}/bin/fabric-ca-client"
export PATH="${WORK}/bin:${PATH}" FAKE_CA_CALLS="${WORK}/ca.calls"

cat > "${WORK}/authorization.json" <<'JSON'
{
  "authorized": true,
  "hostUrl": "https://host.example.invalid",
  "mspId": "HostExampleMSP",
  "hostCredentialId": "urn:uuid:host-credential",
  "networkKind": "production"
}
JSON

AUTHORIZATION_JSON="${WORK}/authorization.json" \
CA_URL="https://fabric-ica.example.invalid:7054" \
CA_NAME='fabric-ica-hostexample' \
CA_ADMIN_HOME="${WORK}/ca-admin" \
CLIENT_ENROLLMENT_OUTPUT_FILE="${WORK}/client-grant.json" \
HOST_CLIENT_ENROLLMENT_SECRET='client-secret-must-not-print' \
NOW_EPOCH_SECONDS=1700000000 \
  bash "${ROOT}/scripts/enrollment/register-host-client-enrollment.sh"

jq -e '
  .specVersion == "gdc.fabric.host-client-enrollment-grant/v1" and
  .caName == "fabric-ica-hostexample" and
  .mspId == "HostExampleMSP" and .hostCredentialId == "urn:uuid:host-credential" and
  .maxEnrollments == 1 and .issuedAt == "2023-11-14T22:13:20Z" and
  .expiresAt == "2023-11-14T22:28:20Z"
' "${WORK}/client-grant.json" >/dev/null
grep -Fq -- '--id.type client' "${WORK}/ca.calls"
grep -Fq -- '--caname fabric-ica-hostexample' "${WORK}/ca.calls"
credential_digest="$(printf '%s' 'urn:uuid:host-credential' | shasum -a 256 | awk '{print $1}')"
grep -Fq -- "gdc.hostCredentialSha256=${credential_digest}:ecert" "${WORK}/ca.calls"
! grep -Fq -- 'gdc.hostCredentialId=' "${WORK}/ca.calls"

AUTHORIZATION_JSON="${WORK}/authorization.json" \
CA_URL="https://fabric-ica.example.invalid:7054" \
CA_ADMIN_HOME="${WORK}/ca-admin" \
CLIENT_ENROLLMENT_OUTPUT_FILE="${WORK}/weekend-client-grant.json" \
HOST_CLIENT_ENROLLMENT_ID='host-gw-weekend-window' \
HOST_CLIENT_ENROLLMENT_SECRET='weekend-client-secret' \
ENROLLMENT_GRANT_TTL_SECONDS=259200 \
NOW_EPOCH_SECONDS=1700000000 \
  bash "${ROOT}/scripts/enrollment/register-host-client-enrollment.sh"
jq -e '
  .expiresAt == "2023-11-17T22:13:20Z" and .maxEnrollments == 1
' "${WORK}/weekend-client-grant.json" >/dev/null

ENROLLMENT_GRANT_FILE="${WORK}/client-grant.json" \
HOST_CLIENT_OUTPUT_DIR="${WORK}/gw-client" \
NOW_EPOCH_SECONDS=1700000001 \
  bash "${ROOT}/scripts/enrollment/enroll-host-client.sh"

test -s "${WORK}/gw-client/msp/signcerts/cert.pem"
test -s "${WORK}/gw-client/msp/keystore/key.pem"
printf '%s\n' '-----BEGIN CERTIFICATE-----' 'tls-root' '-----END CERTIFICATE-----' > "${WORK}/peer-ca.pem"

HOST_CLIENT_MSP_DIR="${WORK}/gw-client/msp" \
HOST_MSP_ID=HostExampleMSP \
HOST_PEER_ENDPOINT=peer0.host.example.invalid:7051 \
HOST_PEER_TLS_CA="${WORK}/peer-ca.pem" \
GW_FABRIC_ENV_OUTPUT="${WORK}/gw.fabric.env" \
  bash "${ROOT}/scripts/onboarding/render-gw-fabric-env.sh"

grep -qx 'LEDGER_FABRIC_MSP_ID=HostExampleMSP' "${WORK}/gw.fabric.env"
grep -qx 'HLF_MSP_ID_HOST1=HostExampleMSP' "${WORK}/gw.fabric.env"
grep -qx 'HLF_CONNECTION_PEER=peer0.host.example.invalid:7051' "${WORK}/gw.fabric.env"
grep -Fq 'HLF_CERTIFICATE=-----BEGIN CERTIFICATE-----\nclient-certificate' "${WORK}/gw.fabric.env"
grep -Fq 'HLF_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nclient-private-key' "${WORK}/gw.fabric.env"
! grep -Fq 'client-secret-must-not-print' "${WORK}/gw.fabric.env"
[[ "$(stat -f '%Lp' "${WORK}/gw.fabric.env" 2>/dev/null || stat -c '%a' "${WORK}/gw.fabric.env")" == "600" ]]
