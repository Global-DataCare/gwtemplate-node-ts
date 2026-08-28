#!/usr/bin/env bash
# Flow contract:
# 1. a disposable dataspace ICA signs a Host VC-JWT for Host2;
# 2. controller decision and current operator token authorize the same URL/MSP;
# 3. only the sanitized authorization is persisted for Fabric enrollment.
# Authorization invariant: VC subject, request URL, decision MSP and inventory all match.
# Persistence invariant: no private key, token or raw VC-JWT enters the output.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

node "${ROOT}/scripts/onboarding/create-local-audit-authorization.mjs" \
  --output "${WORK}/authorization.json" \
  --bundle-dir "${WORK}/governance"
jq -e '
  .authorized == true and
  .mspId == "Host2MSP" and
  .networkKind == "local-network" and
  .hostUrl == "http://host2.localhost" and
  .evidencePolicy == "hosting-service-credential" and
  (.hostCredentialId | startswith("urn:uuid:"))
' "${WORK}/authorization.json" >/dev/null
! rg -n 'PRIVATE KEY|hostCredentialJwt|identityToken|enrollmentSecret' "${WORK}"
for artifact in decision.json controller-did.json inventory.json identity-jwks.json; do
  [[ -s "${WORK}/governance/${artifact}" ]]
done
jq -e '.decision.changes | map(.channel) | sort == ["health-care-local", "identity-local"]' \
  "${WORK}/governance/decision.json" >/dev/null
