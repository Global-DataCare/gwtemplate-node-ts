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
if [[ "${authorized}" != "true" || -z "${host_url}" || -z "${msp_id}" || -z "${credential_id}" ]]; then
  echo "Authorization JSON is incomplete or not authorized" >&2
  exit 1
fi

enrollment_id="${HOST_ENROLLMENT_ID:-host-$(printf '%s' "${host_url}" | shasum -a 256 | cut -c1-20)}"
enrollment_secret="${HOST_ENROLLMENT_SECRET:-$(openssl rand -base64 36 | tr -d '=+/' | cut -c1-32)}"
tls_args=()
if [[ -n "${CA_TLS_CERT:-}" ]]; then
  tls_args=(--tls.certfiles "${CA_TLS_CERT}")
fi

export FABRIC_CA_CLIENT_HOME="${CA_ADMIN_HOME}"
fabric-ca-client register \
  -u "${CA_URL}" \
  --id.name "${enrollment_id}" \
  --id.secret "${enrollment_secret}" \
  --id.type peer \
  --id.maxenrollments 2 \
  --id.attrs "gdc.mspId=${msp_id}:ecert,gdc.hostCredentialId=${credential_id}:ecert" \
  "${tls_args[@]}"

umask 077
jq -n \
  --arg specVersion "gdc.fabric.host-enrollment-grant/v1" \
  --arg enrollmentId "${enrollment_id}" \
  --arg enrollmentSecret "${enrollment_secret}" \
  --arg caUrl "${CA_URL}" \
  --arg mspId "${msp_id}" \
  --arg hostUrl "${host_url}" \
  --arg hostCredentialId "${credential_id}" \
  '{
    specVersion: $specVersion,
    enrollmentId: $enrollmentId,
    enrollmentSecret: $enrollmentSecret,
    caUrl: $caUrl,
    mspId: $mspId,
    hostUrl: $hostUrl,
    hostCredentialId: $hostCredentialId,
    maxEnrollments: 2
  }' > "${ENROLLMENT_OUTPUT_FILE}"
chmod 600 "${ENROLLMENT_OUTPUT_FILE}"

echo "One-time host enrollment grant written to ${ENROLLMENT_OUTPUT_FILE}" >&2
