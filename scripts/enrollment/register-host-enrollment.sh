#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${AUTHORIZATION_JSON:-}" || -z "${CA_URL:-}" || -z "${CA_ADMIN_HOME:-}" || -z "${ENROLLMENT_OUTPUT_FILE:-}" ]]; then
  echo "Missing AUTHORIZATION_JSON, CA_URL, CA_ADMIN_HOME or ENROLLMENT_OUTPUT_FILE" >&2
  exit 1
fi

authorized="$(jq -r '.authorized // false' "${AUTHORIZATION_JSON}")"
host_url="$(jq -r '.hostUrl // empty' "${AUTHORIZATION_JSON}")"
msp_id="$(jq -r '.mspId // empty' "${AUTHORIZATION_JSON}")"
credential_id="$(jq -r '.hostCredentialId // empty' "${AUTHORIZATION_JSON}")"
network_kind="$(jq -r '.networkKind // empty' "${AUTHORIZATION_JSON}")"
if [[ "${authorized}" != "true" || -z "${host_url}" || -z "${msp_id}" || -z "${credential_id}" || -z "${network_kind}" ]]; then
  echo "Authorization JSON is incomplete or not authorized" >&2
  exit 1
fi
credential_digest="$(printf '%s' "${credential_id}" | shasum -a 256 | awk '{print $1}')"

now_epoch_seconds="${NOW_EPOCH_SECONDS:-$(date -u +%s)}"
grant_ttl_seconds="${ENROLLMENT_GRANT_TTL_SECONDS:-900}"
if ! [[ "${now_epoch_seconds}" =~ ^[0-9]+$ && "${grant_ttl_seconds}" =~ ^[0-9]+$ ]] \
  || (( grant_ttl_seconds < 60 || grant_ttl_seconds > 259200 )); then
  echo "ENROLLMENT_GRANT_TTL_SECONDS must be an integer between 60 and 259200" >&2
  exit 1
fi
issued_at="$(node -e 'process.stdout.write(new Date(Number(process.argv[1]) * 1000).toISOString().replace(".000Z", "Z"))' "${now_epoch_seconds}")"
expires_at="$(node -e 'process.stdout.write(new Date((Number(process.argv[1]) + Number(process.argv[2])) * 1000).toISOString().replace(".000Z", "Z"))' "${now_epoch_seconds}" "${grant_ttl_seconds}")"

enrollment_id="${HOST_ENROLLMENT_ID:-host-$(printf '%s' "${host_url}" | shasum -a 256 | cut -c1-20)}"
enrollment_secret="${HOST_ENROLLMENT_SECRET:-$(openssl rand -base64 36 | tr -d '=+/' | cut -c1-32)}"
export FABRIC_CA_CLIENT_HOME="${CA_ADMIN_HOME}"
register_args=(-u "${CA_URL}" --id.name "${enrollment_id}" --id.secret "${enrollment_secret}"
  --id.type peer --id.maxenrollments 2
  --id.attrs "gdc.mspId=${msp_id}:ecert,gdc.hostCredentialSha256=${credential_digest}:ecert")
[[ -z "${CA_TLS_CERT:-}" ]] || register_args+=(--tls.certfiles "${CA_TLS_CERT}")
fabric-ca-client register "${register_args[@]}"

umask 077
jq -n \
  --arg specVersion "gdc.fabric.host-enrollment-grant/v1" \
  --arg enrollmentId "${enrollment_id}" \
  --arg enrollmentSecret "${enrollment_secret}" \
  --arg caUrl "${CA_URL}" \
  --arg mspId "${msp_id}" \
  --arg hostUrl "${host_url}" \
  --arg hostCredentialId "${credential_id}" \
  --arg networkKind "${network_kind}" \
  --arg issuedAt "${issued_at}" \
  --arg expiresAt "${expires_at}" \
  '{
    specVersion: $specVersion,
    enrollmentId: $enrollmentId,
    enrollmentSecret: $enrollmentSecret,
    caUrl: $caUrl,
    mspId: $mspId,
    hostUrl: $hostUrl,
    hostCredentialId: $hostCredentialId,
    networkKind: $networkKind,
    issuedAt: $issuedAt,
    expiresAt: $expiresAt,
    maxEnrollments: 2
  }' > "${ENROLLMENT_OUTPUT_FILE}"
chmod 600 "${ENROLLMENT_OUTPUT_FILE}"

echo "Bounded two-use peer MSP/TLS enrollment grant written to ${ENROLLMENT_OUTPUT_FILE}" >&2
