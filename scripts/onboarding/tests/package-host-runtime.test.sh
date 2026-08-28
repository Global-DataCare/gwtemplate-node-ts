#!/usr/bin/env bash
# Flow contract:
# 1. The host packages peer MSP/TLS and a sanitized authorization for Kubernetes.
# 2. The package manifest binds every artifact by SHA-256 without exposing keys.
# 3. Enrollment grants and their secrets never enter the runtime bundle.
# Authorization invariant: authorization MSP, URL and credential ID must match the grant.
# Persistence invariant: runtime artifacts are private and deterministic inputs to Kubernetes Secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${WORK}/identity/msp/keystore" "${WORK}/identity/tls/keystore"
printf 'msp-key\n' > "${WORK}/identity/msp/keystore/key.pem"
printf 'tls-key\n' > "${WORK}/identity/tls/keystore/key.pem"
cat > "${WORK}/authorization.json" <<'JSON'
{
  "authorized": true,
  "requestId": "urn:uuid:00000000-0000-4000-8000-000000000001",
  "decisionDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "hostUrl": "https://host.example.invalid",
  "mspId": "Host2MSP",
  "networkKind": "test-network",
  "evidencePolicy": "hosting-service-credential",
  "hostCredentialId": "urn:uuid:10000000-0000-4000-8000-000000000001",
  "hostCredentialIssuer": "did:web:ica.example.invalid",
  "peerTargets": ["host2-peer"]
}
JSON
cat > "${WORK}/grant.json" <<'JSON'
{
  "specVersion": "gdc.fabric.host-enrollment-grant/v1",
  "enrollmentId": "secret-id",
  "enrollmentSecret": "must-not-leak",
  "caUrl": "https://fabric-ca.example.invalid:7054",
  "mspId": "Host2MSP",
  "hostUrl": "https://host.example.invalid",
  "hostCredentialId": "urn:uuid:10000000-0000-4000-8000-000000000001",
  "networkKind": "test-network",
  "issuedAt": "2026-07-29T09:06:00Z",
  "expiresAt": "2026-07-29T09:21:00Z",
  "maxEnrollments": 2
}
JSON

HOST_IDENTITY_DIR="${WORK}/identity" \
AUTHORIZATION_JSON="${WORK}/authorization.json" \
ENROLLMENT_GRANT_FILE="${WORK}/grant.json" \
HOST_RUNTIME_OUTPUT_DIR="${WORK}/runtime" \
  bash "${ROOT}/scripts/onboarding/package-host-runtime.sh"

for artifact in msp.tgz tls.tgz authorization.json manifest.sha256; do
  [[ -s "${WORK}/runtime/${artifact}" ]]
done
[[ "$(stat -f '%Lp' "${WORK}/runtime" 2>/dev/null || stat -c '%a' "${WORK}/runtime")" == "700" ]]
[[ "$(stat -f '%Lp' "${WORK}/runtime/msp.tgz" 2>/dev/null || stat -c '%a' "${WORK}/runtime/msp.tgz")" == "600" ]]
(cd "${WORK}/runtime" && shasum -a 256 -c manifest.sha256)
! rg -n 'must-not-leak|enrollmentSecret|hostCredentialJwt' "${WORK}/runtime"
jq -e '.authorized and .mspId == "Host2MSP" and .networkKind == "test-network"' \
  "${WORK}/runtime/authorization.json" >/dev/null
