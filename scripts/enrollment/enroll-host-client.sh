#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ENROLLMENT_GRANT_FILE:-}" || -z "${HOST_CLIENT_OUTPUT_DIR:-}" ]]; then
  echo 'Missing ENROLLMENT_GRANT_FILE or HOST_CLIENT_OUTPUT_DIR' >&2
  exit 1
fi
spec_version="$(jq -r '.specVersion // empty' "${ENROLLMENT_GRANT_FILE}")"
enrollment_id="$(jq -r '.enrollmentId // empty' "${ENROLLMENT_GRANT_FILE}")"
enrollment_secret="$(jq -r '.enrollmentSecret // empty' "${ENROLLMENT_GRANT_FILE}")"
ca_url="$(jq -r '.caUrl // empty' "${ENROLLMENT_GRANT_FILE}")"
expires_at="$(jq -r '.expiresAt // empty' "${ENROLLMENT_GRANT_FILE}")"
max_enrollments="$(jq -r '.maxEnrollments // 0' "${ENROLLMENT_GRANT_FILE}")"
if [[ "${spec_version}" != 'gdc.fabric.host-client-enrollment-grant/v1' \
  || -z "${enrollment_id}" || -z "${enrollment_secret}" || -z "${ca_url}" \
  || -z "${expires_at}" || "${max_enrollments}" != 1 ]]; then
  echo 'GW client enrollment grant is incomplete' >&2
  exit 1
fi
[[ "${ca_url}" == *://* ]] || { echo 'Enrollment grant caUrl must include a URL scheme' >&2; exit 1; }
now_epoch_seconds="${NOW_EPOCH_SECONDS:-$(date -u +%s)}"
expires_epoch_seconds="$(node -e 'const value=Date.parse(process.argv[1]); if(!Number.isFinite(value)) process.exit(2); process.stdout.write(String(Math.floor(value/1000)))' "${expires_at}")" || {
  echo 'GW client enrollment grant expiresAt is invalid' >&2
  exit 1
}
(( now_epoch_seconds < expires_epoch_seconds )) || { echo 'GW client enrollment grant has expired' >&2; exit 1; }
[[ ! -e "${HOST_CLIENT_OUTPUT_DIR}" ]] || {
  echo 'HOST_CLIENT_OUTPUT_DIR already exists; refusing to overwrite private key material' >&2
  exit 1
}
mkdir -p "${HOST_CLIENT_OUTPUT_DIR}"
chmod 700 "${HOST_CLIENT_OUTPUT_DIR}"

ca_scheme="${ca_url%%://*}"
ca_authority="${ca_url#*://}"
enroll_url="${ca_scheme}://${enrollment_id}:${enrollment_secret}@${ca_authority%/}"
export FABRIC_CA_CLIENT_HOME="${HOST_CLIENT_OUTPUT_DIR}"
enroll_args=(-u "${enroll_url}")
[[ -z "${CA_TLS_CERT:-}" ]] || enroll_args+=(--tls.certfiles "${CA_TLS_CERT}")
fabric-ca-client enroll "${enroll_args[@]}"
echo "GW Fabric client identity generated locally in ${HOST_CLIENT_OUTPUT_DIR}" >&2
