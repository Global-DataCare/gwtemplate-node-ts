#!/usr/bin/env bash
# Flow contract:
# 1. One host fullname and namespace determine every CCAAS Service address.
# 2. Nine deterministic packages produce exact Fabric package IDs and a values fragment.
# 3. Repeating the command with the same inputs produces identical hashes.
# Authorization invariant: package names come from the published allowlist, not user input.
# Persistence invariant: package archives and values are sufficient for later install/approval.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

HOST_FULLNAME=host2 \
KUBE_NAMESPACE=host2-system \
CCAAS_IMAGE='registry.example.invalid/host-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
CCAAS_OUTPUT_DIR="${WORK}/first" \
  bash "${ROOT}/scripts/onboarding/prepare-ccaas-packages.sh"
HOST_FULLNAME=host2 \
KUBE_NAMESPACE=host2-system \
CCAAS_IMAGE='registry.example.invalid/host-runtime@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
CCAAS_OUTPUT_DIR="${WORK}/second" \
  bash "${ROOT}/scripts/onboarding/prepare-ccaas-packages.sh"

[[ "$(find "${WORK}/first" -name '*.tgz' | wc -l | tr -d ' ')" == "9" ]]
[[ "$(yq '.chaincodes | length' "${WORK}/first/chaincodes.values.yaml")" == "9" ]]
grep -R -Fq 'host2-cc-organization-sc.host2-system.svc.cluster.local:9999' "${WORK}/first/packages"
diff -r "${WORK}/first" "${WORK}/second"
while IFS=$'\t' read -r name channel archive package_id; do
  digest="$(shasum -a 256 "${WORK}/first/${archive}" | awk '{print $1}')"
  [[ "${package_id}" == "${name}-v1:${digest}" ]]
  [[ "${channel}" == identity-* || "${channel}" == health-care-* ]]
done < "${WORK}/first/manifest.tsv"
