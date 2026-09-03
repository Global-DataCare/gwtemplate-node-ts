# Flow contract: the network governor creates and retains each MSP administrator; the host receives no administrator secret.
#!/usr/bin/env bash
# Journey:
# 1. A signed host authorization fixes the governance-assigned MSP identifier.
# 2. The Fabric authority registers and enrolls that MSP administrator locally.
# 3. The authority exports only a public MSP definition without any private key or enrollment secret.
# Authorization invariant: the administrator MSP is copied from the approved authorization, never selected by the host.
# Persistence invariant: the administrator private key remains under authority custody and the public package is secret-free.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/bin" "${WORK}/ca-registrar/msp"

cat > "${WORK}/bin/fabric-ca-client" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_CA_CALLS}"
if [[ "${1:-}" == "enroll" ]]; then
  mkdir -p "${FABRIC_CA_CLIENT_HOME}/msp/cacerts" \
    "${FABRIC_CA_CLIENT_HOME}/msp/intermediatecerts" \
    "${FABRIC_CA_CLIENT_HOME}/msp/signcerts" \
    "${FABRIC_CA_CLIENT_HOME}/msp/keystore"
  printf '%s\n' root-public > "${FABRIC_CA_CLIENT_HOME}/msp/cacerts/root.pem"
  printf '%s\n' issuer-public > "${FABRIC_CA_CLIENT_HOME}/msp/intermediatecerts/issuer.pem"
  printf '%s\n' admin-public > "${FABRIC_CA_CLIENT_HOME}/msp/signcerts/cert.pem"
  printf '%s\n' admin-private > "${FABRIC_CA_CLIENT_HOME}/msp/keystore/key.pem"
fi
SCRIPT
chmod +x "${WORK}/bin/fabric-ca-client"

cat > "${WORK}/authorization.json" <<'JSON'
{
  "authorized": true,
  "hostUrl": "https://host.example.invalid",
  "mspId": "HOSTEXAMPLEMSP",
  "networkKind": "network",
  "hostCredentialId": "urn:uuid:10000000-0000-4000-8000-000000000001"
}
JSON

PATH="${WORK}/bin:${PATH}" \
FAKE_CA_CALLS="${WORK}/ca.calls" \
AUTHORIZATION_JSON="${WORK}/authorization.json" \
CA_URL="https://fabric-ca.example.invalid:7054" \
CA_NAME='fabric-ica-hostexample' \
CA_ADMIN_HOME="${WORK}/ca-registrar" \
MSP_ADMIN_OUTPUT_DIR="${WORK}/authority/HOSTEXAMPLEMSP-admin" \
MSP_PUBLIC_OUTPUT_DIR="${WORK}/authority/HOSTEXAMPLEMSP-public" \
MSP_ADMIN_ENROLLMENT_SECRET='must-never-leave-authority' \
  bash "${ROOT}/scripts/enrollment/provision-governed-msp-admin.sh"

grep -Fq -- '--id.type admin' "${WORK}/ca.calls"
grep -Fq -- '--id.maxenrollments 1' "${WORK}/ca.calls"
grep -Fq -- '--caname fabric-ica-hostexample' "${WORK}/ca.calls"
test -s "${WORK}/authority/HOSTEXAMPLEMSP-admin/msp/keystore/key.pem"
test -s "${WORK}/authority/HOSTEXAMPLEMSP-public/admincerts/admin-cert.pem"
test -s "${WORK}/authority/HOSTEXAMPLEMSP-public/cacerts/root.pem"
test -s "${WORK}/authority/HOSTEXAMPLEMSP-public/intermediatecerts/issuer.pem"
test -s "${WORK}/authority/HOSTEXAMPLEMSP-public/msp-metadata.json"
jq -e '.mspId == "HOSTEXAMPLEMSP" and .governanceManaged == true' \
  "${WORK}/authority/HOSTEXAMPLEMSP-public/msp-metadata.json" >/dev/null
jq -e 'has("hostUrl") | not' \
  "${WORK}/authority/HOSTEXAMPLEMSP-public/msp-metadata.json" >/dev/null
! find "${WORK}/authority/HOSTEXAMPLEMSP-public" -type d -name keystore | grep -q .
! rg -n 'admin-private|must-never-leave-authority|enrollmentSecret' \
  "${WORK}/authority/HOSTEXAMPLEMSP-public"

first_call_count="$(wc -l < "${WORK}/ca.calls")"
jq '.hostUrl = "https://second-host.example.invalid" | .hostCredentialId = "urn:uuid:20000000-0000-4000-8000-000000000002"' \
  "${WORK}/authorization.json" > "${WORK}/second-host-authorization.json"
PATH="${WORK}/bin:${PATH}" \
FAKE_CA_CALLS="${WORK}/ca.calls" \
AUTHORIZATION_JSON="${WORK}/second-host-authorization.json" \
CA_URL="https://fabric-ca.example.invalid:7054" \
CA_NAME='fabric-ica-hostexample' \
CA_ADMIN_HOME="${WORK}/ca-registrar" \
MSP_ADMIN_OUTPUT_DIR="${WORK}/authority/HOSTEXAMPLEMSP-admin" \
MSP_PUBLIC_OUTPUT_DIR="${WORK}/authority/HOSTEXAMPLEMSP-public" \
  bash "${ROOT}/scripts/enrollment/provision-governed-msp-admin.sh"
[[ "$(wc -l < "${WORK}/ca.calls")" == "${first_call_count}" ]]
