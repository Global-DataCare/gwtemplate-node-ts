#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ENROLLMENT_GRANT_FILE:-}" || -z "${HOST_MSP_OUTPUT_DIR:-}" || -z "${HOST_PEER_DNS:-}" ]]; then
  echo "Missing ENROLLMENT_GRANT_FILE, HOST_MSP_OUTPUT_DIR or HOST_PEER_DNS" >&2
  exit 1
fi

enrollment_id="$(jq -r '.enrollmentId // empty' "${ENROLLMENT_GRANT_FILE}")"
enrollment_secret="$(jq -r '.enrollmentSecret // empty' "${ENROLLMENT_GRANT_FILE}")"
ca_url="$(jq -r '.caUrl // empty' "${ENROLLMENT_GRANT_FILE}")"
ca_name="$(jq -r '.caName // empty' "${ENROLLMENT_GRANT_FILE}")"
spec_version="$(jq -r '.specVersion // empty' "${ENROLLMENT_GRANT_FILE}")"
expires_at="$(jq -r '.expiresAt // empty' "${ENROLLMENT_GRANT_FILE}")"
max_enrollments="$(jq -r '.maxEnrollments // 0' "${ENROLLMENT_GRANT_FILE}")"
if [[ "${spec_version}" != "gdc.fabric.host-enrollment-grant/v1" \
  || -z "${enrollment_id}" || -z "${enrollment_secret}" || -z "${ca_url}" || -z "${expires_at}" \
  || "${max_enrollments}" != "2" ]]; then
  echo "Enrollment grant is incomplete" >&2
  exit 1
fi
if [[ "${ca_url}" != *"://"* ]]; then
  echo "Enrollment grant caUrl must include a URL scheme" >&2
  exit 1
fi
now_epoch_seconds="${NOW_EPOCH_SECONDS:-$(date -u +%s)}"
expires_epoch_seconds="$(node -e 'const value = Date.parse(process.argv[1]); if (!Number.isFinite(value)) process.exit(2); process.stdout.write(String(Math.floor(value / 1000)))' "${expires_at}")" || {
  echo "Enrollment grant expiresAt is invalid" >&2
  exit 1
}
if (( now_epoch_seconds >= expires_epoch_seconds )); then
  echo "Enrollment grant has expired" >&2
  exit 1
fi
ca_scheme="${ca_url%%://*}"
ca_authority="${ca_url#*://}"
enroll_url="${ca_scheme}://${enrollment_id}:${enrollment_secret}@${ca_authority%/}"

if [[ -e "${HOST_MSP_OUTPUT_DIR}" ]]; then
  echo "HOST_MSP_OUTPUT_DIR already exists; refusing to overwrite private key material" >&2
  exit 1
fi
mkdir -p "${HOST_MSP_OUTPUT_DIR}"
chmod 700 "${HOST_MSP_OUTPUT_DIR}"

# fabric-ca-client creates both private keys locally under HOST_MSP_OUTPUT_DIR.
# Only the CSR/public key crosses the network; no private key is downloaded.
export FABRIC_CA_CLIENT_HOME="${HOST_MSP_OUTPUT_DIR}"
enroll_args=(-u "${enroll_url}" --csr.hosts "${HOST_PEER_DNS}")
[[ -z "${CA_TLS_CERT:-}" ]] || enroll_args+=(--tls.certfiles "${CA_TLS_CERT}")
[[ -z "${ca_name}" ]] || enroll_args+=(--caname "${ca_name}")
fabric-ca-client enroll "${enroll_args[@]}"

export FABRIC_CA_CLIENT_MSPDIR=tls
tls_enroll_args=(-u "${enroll_url}" --enrollment.profile tls --csr.hosts "${HOST_PEER_DNS}")
[[ -z "${CA_TLS_CERT:-}" ]] || tls_enroll_args+=(--tls.certfiles "${CA_TLS_CERT}")
[[ -z "${ca_name}" ]] || tls_enroll_args+=(--caname "${ca_name}")
fabric-ca-client enroll "${tls_enroll_args[@]}"

unset FABRIC_CA_CLIENT_MSPDIR
echo "Host MSP and TLS identities generated locally in ${HOST_MSP_OUTPUT_DIR}" >&2
