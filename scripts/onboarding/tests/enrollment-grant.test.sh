#!/usr/bin/env bash
# Flow contract:
# 1. The authority accepts only an authorization bound to a Host VC.
# 2. Fabric CA registration creates a two-enrollment grant with an explicit expiry.
# 3. The host rejects an expired grant before creating private-key directories.
# Authorization invariant: neither controller approval alone nor an expired grant can enroll a peer.
# Persistence invariant: secrets are mode 0600 and are never written to stdout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${WORK}/bin" "${WORK}/ca-admin"
cat > "${WORK}/bin/fabric-ca-client" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_FABRIC_CA_CALLS}"
SCRIPT
chmod +x "${WORK}/bin/fabric-ca-client"

cat > "${WORK}/authorization.json" <<'JSON'
{
  "authorized": true,
  "hostUrl": "https://host.example.invalid",
  "mspId": "Host2MSP",
  "networkKind": "test-network",
  "hostCredentialId": "urn:uuid:10000000-0000-4000-8000-000000000001"
}
JSON

grant="${WORK}/grant.json"
stderr="${WORK}/register.stderr"
PATH="${WORK}/bin:${PATH}" \
FAKE_FABRIC_CA_CALLS="${WORK}/calls.log" \
AUTHORIZATION_JSON="${WORK}/authorization.json" \
CA_URL="https://fabric-ca.example.invalid:7054" \
CA_ADMIN_HOME="${WORK}/ca-admin" \
ENROLLMENT_OUTPUT_FILE="${grant}" \
ENROLLMENT_GRANT_TTL_SECONDS=900 \
NOW_EPOCH_SECONDS=1785315960 \
  bash "${ROOT}/scripts/enrollment/register-host-enrollment.sh" 2>"${stderr}"

jq -e '
  .specVersion == "gdc.fabric.host-enrollment-grant/v1" and
  .networkKind == "test-network" and
  .maxEnrollments == 2 and
  .issuedAt == "2026-07-29T09:06:00Z" and
  .expiresAt == "2026-07-29T09:21:00Z"
' "${grant}" >/dev/null
[[ "$(stat -f '%Lp' "${grant}" 2>/dev/null || stat -c '%a' "${grant}")" == "600" ]]
! grep -Fq 'enrollmentSecret' "${stderr}"

NOW_EPOCH_SECONDS=1785316861 \
ENROLLMENT_GRANT_FILE="${grant}" \
HOST_MSP_OUTPUT_DIR="${WORK}/expired-host" \
HOST_PEER_DNS="peer0.host.example.invalid" \
PATH="${WORK}/bin:${PATH}" \
FAKE_FABRIC_CA_CALLS="${WORK}/calls.log" \
  bash "${ROOT}/scripts/enrollment/enroll-host-msp.sh" >"${WORK}/enroll.stdout" 2>"${WORK}/enroll.stderr" && {
    echo 'Expired enrollment grant was accepted.' >&2
    exit 1
  }
grep -Fq 'has expired' "${WORK}/enroll.stderr"
[[ ! -e "${WORK}/expired-host" ]]
