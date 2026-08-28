#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${ENROLLMENT_GRANT_FILE:-}" || -z "${HOST_MSP_OUTPUT_DIR:-}" || -z "${HOST_PEER_DNS:-}" ]]; then
  echo "Missing ENROLLMENT_GRANT_FILE, HOST_MSP_OUTPUT_DIR or HOST_PEER_DNS" >&2
  exit 1
fi

enrollment_id="$(jq -r '.enrollmentId // empty' "${ENROLLMENT_GRANT_FILE}")"
enrollment_secret="$(jq -r '.enrollmentSecret // empty' "${ENROLLMENT_GRANT_FILE}")"
ca_url="$(jq -r '.caUrl // empty' "${ENROLLMENT_GRANT_FILE}")"
if [[ -z "${enrollment_id}" || -z "${enrollment_secret}" || -z "${ca_url}" ]]; then
  echo "Enrollment grant is incomplete" >&2
  exit 1
fi
if [[ "${ca_url}" != *"://"* ]]; then
  echo "Enrollment grant caUrl must include a URL scheme" >&2
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

tls_args=()
if [[ -n "${CA_TLS_CERT:-}" ]]; then
  tls_args=(--tls.certfiles "${CA_TLS_CERT}")
fi

# fabric-ca-client creates both private keys locally under HOST_MSP_OUTPUT_DIR.
# Only the CSR/public key crosses the network; no private key is downloaded.
export FABRIC_CA_CLIENT_HOME="${HOST_MSP_OUTPUT_DIR}"
fabric-ca-client enroll \
  -u "${enroll_url}" \
  --csr.hosts "${HOST_PEER_DNS}" \
  "${tls_args[@]}"

export FABRIC_CA_CLIENT_MSPDIR=tls
fabric-ca-client enroll \
  -u "${enroll_url}" \
  --enrollment.profile tls \
  --csr.hosts "${HOST_PEER_DNS}" \
  "${tls_args[@]}"

unset FABRIC_CA_CLIENT_MSPDIR
echo "Host MSP and TLS identities generated locally in ${HOST_MSP_OUTPUT_DIR}" >&2
