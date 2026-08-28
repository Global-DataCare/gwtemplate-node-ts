#!/usr/bin/env bash
# Flow contract: validate a provider-owned host profile without contacting or
# mutating a cluster; require immutable workload images and secret-free output.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 3 ]]; then
  echo "Usage: $0 <values.yaml> [namespace] [release]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="${ROOT}/charts/gdc-host"
VALUES_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
NAMESPACE="${2:-gdc-host}"
RELEASE="${3:-host}"
RENDERED="$(mktemp)"
trap 'rm -f "${RENDERED}"' EXIT

helm lint --strict "${CHART}" -f "${VALUES_FILE}"
helm template "${RELEASE}" "${CHART}" \
  --namespace "${NAMESPACE}" \
  -f "${VALUES_FILE}" > "${RENDERED}"

if grep -E '^[[:space:]]*image:' "${RENDERED}" | grep -vq '@sha256:'; then
  echo "Rendered host contains a mutable container image" >&2
  exit 1
fi
if grep -Eq '^kind:[[:space:]]*Secret$|^[[:space:]]*stringData:' "${RENDERED}"; then
  echo "Rendered host must reference existing secrets, never create secret material" >&2
  exit 1
fi

echo "Host values validated: release=${RELEASE} namespace=${NAMESPACE}"
