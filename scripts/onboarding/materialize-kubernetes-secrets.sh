#!/usr/bin/env bash
# Converges the six Secret objects consumed by one gdc-host Helm release.
# Input files remain provider-owned; this helper never reads or prints values.
set -euo pipefail

for variable in KUBE_CONTEXT KUBE_NAMESPACE HELM_RELEASE HOST_RUNTIME_DIR \
  POSTGRES_SECRET_ENV_FILE COUCHDB_SECRET_ENV_FILE GW_SECRET_ENV_FILE; do
  [[ -n "${!variable:-}" ]] || {
    echo "Missing ${variable}" >&2
    exit 1
  }
done
[[ "${HELM_RELEASE}" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || {
  echo "HELM_RELEASE must be a DNS label" >&2
  exit 1
}
for input in \
  "${HOST_RUNTIME_DIR}/msp.tgz" \
  "${HOST_RUNTIME_DIR}/tls.tgz" \
  "${HOST_RUNTIME_DIR}/authorization.json" \
  "${POSTGRES_SECRET_ENV_FILE}" \
  "${COUCHDB_SECRET_ENV_FILE}" \
  "${GW_SECRET_ENV_FILE}"; do
  [[ -s "${input}" ]] || {
    echo "Missing non-empty input file: ${input}" >&2
    exit 1
  }
done
if [[ -n "${REDIS_SECRET_ENV_FILE:-}" && ! -s "${REDIS_SECRET_ENV_FILE}" ]]; then
  echo "Missing non-empty input file: ${REDIS_SECRET_ENV_FILE}" >&2
  exit 1
fi
kubectl --context "${KUBE_CONTEXT}" get namespace "${KUBE_NAMESPACE}" >/dev/null

apply_secret() {
  local name="$1"
  shift
  kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" \
    create secret generic "${name}" "$@" --dry-run=client -o yaml \
    | kubectl --context "${KUBE_CONTEXT}" -n "${KUBE_NAMESPACE}" apply -f - >/dev/null
}

apply_secret "${HELM_RELEASE}-peer-msp" --from-file=msp.tgz="${HOST_RUNTIME_DIR}/msp.tgz"
apply_secret "${HELM_RELEASE}-peer-tls" --from-file=tls.tgz="${HOST_RUNTIME_DIR}/tls.tgz"
apply_secret "${HELM_RELEASE}-authorization" \
  --from-file=authorization.json="${HOST_RUNTIME_DIR}/authorization.json"
apply_secret "${HELM_RELEASE}-postgresql" --from-env-file="${POSTGRES_SECRET_ENV_FILE}"
apply_secret "${HELM_RELEASE}-couchdb" --from-env-file="${COUCHDB_SECRET_ENV_FILE}"
apply_secret "${HELM_RELEASE}-gw" --from-env-file="${GW_SECRET_ENV_FILE}"
if [[ -n "${REDIS_SECRET_ENV_FILE:-}" ]]; then
  apply_secret "${HELM_RELEASE}-redis" --from-env-file="${REDIS_SECRET_ENV_FILE}"
fi

echo "Kubernetes Secrets converged for release ${HELM_RELEASE} in the selected context and namespace." >&2
