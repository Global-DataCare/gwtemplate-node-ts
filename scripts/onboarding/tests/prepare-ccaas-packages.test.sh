# Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
#!/usr/bin/env bash
# 1. Every isolated host namespace exposes the same release-neutral CCAAS Service names.
# 2. Ten deterministic packages produce exact Fabric package IDs and a values fragment.
# 3. Repeating the command with the same inputs produces identical hashes.
# 4. artifact-sc is approved on identity channels and the clinical data channel.
# Authorization invariant: package names come from the published allowlist, not user input.
# Persistence invariant: package archives and values are sufficient for later install/approval.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

CCAAS_IMAGE='registry.example.invalid/host-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
CCAAS_OUTPUT_DIR="${WORK}/first" \
  bash "${ROOT}/scripts/onboarding/prepare-ccaas-packages.sh"
CCAAS_IMAGE='registry.example.invalid/host-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
CCAAS_OUTPUT_DIR="${WORK}/second" \
  bash "${ROOT}/scripts/onboarding/prepare-ccaas-packages.sh"

[[ "$(find "${WORK}/first" -name '*.tgz' | wc -l | tr -d ' ')" == "10" ]]
[[ "$(yq '.chaincodes | length' "${WORK}/first/chaincodes.values.yaml")" == "10" ]]
grep -R -Fq 'gdc-cc-organization-sc:9999' "${WORK}/first/packages"
if grep -R -Eq 'host2|\.svc\.cluster\.local' "${WORK}/first/packages"; then
  echo 'CCAAS packages must not contain host- or namespace-specific addresses' >&2
  exit 1
fi
grep -Fq $'artifact-sc\tidentity-global,identity-eu,health-care-eu\t' "${WORK}/first/manifest.tsv"
grep -Fq $'subjectidentifier-sc\tidentity-global\t' "${WORK}/first/manifest.tsv"
diff -r "${WORK}/first" "${WORK}/second"
while IFS=$'\t' read -r name channel archive package_id; do
  digest="$(shasum -a 256 "${WORK}/first/${archive}" | awk '{print $1}')"
  [[ "${package_id}" == "${name}-v1:${digest}" ]]
  [[ "${channel}" == identity-* || "${channel}" == health-care-* ]]
done < "${WORK}/first/manifest.tsv"
