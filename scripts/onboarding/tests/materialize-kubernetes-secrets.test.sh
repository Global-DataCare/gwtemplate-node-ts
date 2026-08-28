#!/usr/bin/env bash
# Flow contract:
# 1. The platform materializes every Helm prerequisite in one explicit context and namespace.
# 2. Existing Secrets are converged with client-side manifests instead of embedded values.
# 3. No secret value is printed by the helper.
# Authorization invariant: names are derived from one validated release name.
# Persistence invariant: peer MSP/TLS, authorization, database, CouchDB and GW secrets are all present.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/bin" "${WORK}/runtime"
for artifact in msp.tgz tls.tgz authorization.json; do printf 'fixture\n' > "${WORK}/runtime/${artifact}"; done
printf 'POSTGRES_USER=test\nPOSTGRES_PASSWORD=do-not-print-db\n' > "${WORK}/postgres.env"
printf 'username=test\npassword=do-not-print-couch\n' > "${WORK}/couch.env"
printf 'FABRIC_CLIENT_PRIVATE_KEY=do-not-print-gw\n' > "${WORK}/gw.env"
printf 'REDIS_PASSWORD=do-not-print-redis\n' > "${WORK}/redis.env"

cat > "${WORK}/bin/kubectl" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${FAKE_KUBECTL_CALLS}"
if [[ "$*" == *'--dry-run=client -o yaml'* ]]; then
  printf '%s\n' 'apiVersion: v1' 'kind: Secret' 'metadata:' '  name: fake'
else
  cat >/dev/null
fi
SCRIPT
chmod +x "${WORK}/bin/kubectl"

PATH="${WORK}/bin:${PATH}" \
FAKE_KUBECTL_CALLS="${WORK}/calls.log" \
KUBE_CONTEXT=kind-audit \
KUBE_NAMESPACE=host-audit \
HELM_RELEASE=host2 \
HOST_RUNTIME_DIR="${WORK}/runtime" \
POSTGRES_SECRET_ENV_FILE="${WORK}/postgres.env" \
COUCHDB_SECRET_ENV_FILE="${WORK}/couch.env" \
GW_SECRET_ENV_FILE="${WORK}/gw.env" \
REDIS_SECRET_ENV_FILE="${WORK}/redis.env" \
  bash "${ROOT}/scripts/onboarding/materialize-kubernetes-secrets.sh" \
  >"${WORK}/stdout" 2>"${WORK}/stderr"

for name in host2-peer-msp host2-peer-tls host2-authorization host2-postgresql host2-couchdb host2-gw host2-redis; do
  grep -Fq "create secret generic ${name}" "${WORK}/calls.log"
done
[[ "$(grep -c -- '--context kind-audit' "${WORK}/calls.log")" -eq 12 ]]
! rg -n 'do-not-print' "${WORK}/stdout" "${WORK}/stderr" "${WORK}/calls.log"
