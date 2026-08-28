#!/usr/bin/env bash
# Packages only the host-owned runtime inputs consumed by the Helm chart.
# The enrollment grant is validated but never copied because it contains a
# Fabric CA secret and is no longer needed after MSP/TLS enrollment.
set -euo pipefail

for variable in HOST_IDENTITY_DIR AUTHORIZATION_JSON ENROLLMENT_GRANT_FILE HOST_RUNTIME_OUTPUT_DIR; do
  [[ -n "${!variable:-}" ]] || {
    echo "Missing ${variable}" >&2
    exit 1
  }
done
for executable in jq tar shasum; do
  command -v "${executable}" >/dev/null || {
    echo "Missing executable: ${executable}" >&2
    exit 1
  }
done

[[ -d "${HOST_IDENTITY_DIR}/msp" && -d "${HOST_IDENTITY_DIR}/tls" ]] || {
  echo "HOST_IDENTITY_DIR must contain msp/ and tls/" >&2
  exit 1
}
[[ ! -e "${HOST_RUNTIME_OUTPUT_DIR}" ]] || {
  echo "HOST_RUNTIME_OUTPUT_DIR already exists; refusing to overwrite runtime credentials" >&2
  exit 1
}

authorization_binding="$(jq -r '[.authorized, .mspId, .hostUrl, .hostCredentialId, .networkKind] | @tsv' "${AUTHORIZATION_JSON}")"
grant_binding="$(jq -r '[true, .mspId, .hostUrl, .hostCredentialId, .networkKind] | @tsv' "${ENROLLMENT_GRANT_FILE}")"
if [[ "${authorization_binding}" != "${grant_binding}" ]] \
  || ! jq -e '.authorized == true and .evidencePolicy == "hosting-service-credential"' "${AUTHORIZATION_JSON}" >/dev/null; then
  echo "Authorization and enrollment grant bindings do not match" >&2
  exit 1
fi

umask 077
mkdir -p "${HOST_RUNTIME_OUTPUT_DIR}"
chmod 700 "${HOST_RUNTIME_OUTPUT_DIR}"
COPYFILE_DISABLE=1 tar -C "${HOST_IDENTITY_DIR}/msp" -czf "${HOST_RUNTIME_OUTPUT_DIR}/msp.tgz" .
COPYFILE_DISABLE=1 tar -C "${HOST_IDENTITY_DIR}/tls" -czf "${HOST_RUNTIME_OUTPUT_DIR}/tls.tgz" .
jq '{
  authorized,
  requestId,
  decisionDigest,
  hostUrl,
  mspId,
  networkKind,
  evidencePolicy,
  hostCredentialId,
  hostCredentialIssuer,
  peerTargets
}' "${AUTHORIZATION_JSON}" > "${HOST_RUNTIME_OUTPUT_DIR}/authorization.json"

(
  cd "${HOST_RUNTIME_OUTPUT_DIR}"
  shasum -a 256 msp.tgz tls.tgz authorization.json > manifest.sha256
  chmod 600 msp.tgz tls.tgz authorization.json manifest.sha256
)

echo "Host runtime package created at ${HOST_RUNTIME_OUTPUT_DIR}; enrollment grant was not copied." >&2
