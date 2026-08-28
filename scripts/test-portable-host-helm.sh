#!/usr/bin/env bash
# Flow contract: render one portable governed host from immutable images; keep
# staging and production DNS/network/secret custody separate; materialize peer,
# CouchDB, GW, PostgreSQL, IPFS and CCAAS runtimes without embedding credentials.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART="${ROOT}/charts/gdc-host"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if grep -Eq '^[[:space:]]*kubectl[[:space:]]' "${ROOT}/scripts/validate-host-helm-values.sh"; then
  echo "offline Helm validation contacted Kubernetes" >&2
  exit 1
fi

helm lint "${CHART}" -f "${CHART}/ci/staging-values.yaml"
helm lint "${CHART}" -f "${CHART}/ci/external-staging-values.yaml"
helm lint "${CHART}" -f "${CHART}/ci/production-values.yaml"
helm lint "${CHART}" -f "${CHART}/ci/local-host1-values.yaml"
helm lint "${CHART}" -f "${CHART}/ci/local-host2-values.yaml"
helm lint "${CHART}" -f "${CHART}/ci/local-evidence-values.yaml"
[[ "$(yq '.chaincodes | length' "${CHART}/ci/production-values.yaml")" == "9" ]] || {
  echo 'production example must enumerate all nine CCAAS runtimes' >&2
  exit 1
}
bash "${ROOT}/scripts/validate-host-helm-values.sh" \
  "${CHART}/ci/production-values.yaml" host-production host

helm template host-st "${CHART}" \
  --namespace host-st \
  -f "${CHART}/ci/staging-values.yaml" > "${TMP_DIR}/staging.yaml"
helm template host "${CHART}" \
  --namespace host-production \
  -f "${CHART}/ci/production-values.yaml" > "${TMP_DIR}/production.yaml"
helm template host-st-external "${CHART}" \
  --namespace host-st-external \
  -f "${CHART}/ci/external-staging-values.yaml" > "${TMP_DIR}/external-staging.yaml"
helm template host1 "${CHART}" \
  --namespace local-host1 \
  -f "${CHART}/ci/local-host1-values.yaml" > "${TMP_DIR}/local-host1.yaml"
helm template host2 "${CHART}" \
  --namespace local-host2 \
  -f "${CHART}/ci/local-host2-values.yaml" > "${TMP_DIR}/local-host2.yaml"
helm template host-evidence "${CHART}" \
  --namespace local-host-evidence \
  -f "${CHART}/ci/local-evidence-values.yaml" \
  --set-string gw.localImage=gw-core:evidence \
  --set-string gw.imagePullPolicy=Never > "${TMP_DIR}/local-evidence.yaml"

grep -q 'host-st.example.invalid' "${TMP_DIR}/staging.yaml"
grep -q 'host.example.invalid' "${TMP_DIR}/production.yaml"
grep -q 'NETWORK_MODE: "test-network"' "${TMP_DIR}/staging.yaml"
grep -q 'NETWORK_MODE: "network"' "${TMP_DIR}/production.yaml"
grep -q 'secretName: host-authorization' "${TMP_DIR}/production.yaml"
grep -q 'mountPath: /var/run/gdc-host-authorization' "${TMP_DIR}/production.yaml"
grep -q 'test -s /var/run/gdc-host-authorization/authorization.json' "${TMP_DIR}/production.yaml"
grep -q 'NETWORK_MODE: "local-network"' "${TMP_DIR}/local-host1.yaml"
grep -q 'NETWORK_MODE: "local-network"' "${TMP_DIR}/local-host2.yaml"
grep -q 'LEDGER_FABRIC_MSP_ID: "Host1MSP"' "${TMP_DIR}/local-host1.yaml"
grep -q 'LEDGER_FABRIC_MSP_ID: "Host2MSP"' "${TMP_DIR}/local-host2.yaml"
grep -q 'HOST_EXTERNAL_DOMAIN: "host1.localhost"' "${TMP_DIR}/local-host1.yaml"
grep -q 'HOST_EXTERNAL_DOMAIN: "host2.localhost"' "${TMP_DIR}/local-host2.yaml"
grep -q 'DB_PROVIDER: "mem"' "${TMP_DIR}/local-host1.yaml"
grep -q 'STORAGE_PROVIDER: "mem"' "${TMP_DIR}/local-host2.yaml"
grep -q 'DB_PROVIDER: "postgres"' "${TMP_DIR}/local-evidence.yaml"
grep -q 'STORAGE_PROVIDER: "ipfs"' "${TMP_DIR}/local-evidence.yaml"
grep -q 'imagePullPolicy: Never' "${TMP_DIR}/local-evidence.yaml"
grep -q 'image: "gw-core:evidence"' "${TMP_DIR}/local-evidence.yaml"
grep -q 'image: "gdc-ccaas/organization-sc:local-test"' "${TMP_DIR}/local-evidence.yaml"
grep -A4 'name: chaincode' "${TMP_DIR}/local-evidence.yaml" | grep -q 'imagePullPolicy: Never'
grep -A5 'name: CHAINCODE_ID' "${TMP_DIR}/local-evidence.yaml" | grep -q 'name: CHAINCODE_NAME'
grep -q 'HOST_INTERNAL_IP: "0.0.0.0"' "${TMP_DIR}/local-evidence.yaml"
grep -q 'PORT: "3000"' "${TMP_DIR}/local-evidence.yaml"
grep -q 'SECURITY_MODE: "demo"' "${TMP_DIR}/local-evidence.yaml"
grep -q 'LEDGER_PROVIDER_MAP: "test=mem,local-network=fabric,test-network=fabric,network=fabric"' \
  "${TMP_DIR}/local-evidence.yaml"
grep -q 'app.kubernetes.io/component: postgresql' "${TMP_DIR}/local-evidence.yaml"
grep -q 'app.kubernetes.io/component: ipfs' "${TMP_DIR}/local-evidence.yaml"
if grep -q '^kind: Ingress$' "${TMP_DIR}/local-host1.yaml" \
  || grep -q '^kind: Ingress$' "${TMP_DIR}/local-host2.yaml"; then
  echo "local host profiles exposed an ingress by default" >&2
  exit 1
fi
if cmp -s "${TMP_DIR}/local-host1.yaml" "${TMP_DIR}/local-host2.yaml"; then
  echo "local host profiles rendered the same host boundary" >&2
  exit 1
fi

for component in peer couchdb gw postgresql ipfs redis; do
  grep -q "app.kubernetes.io/component: ${component}" "${TMP_DIR}/production.yaml"
done
grep -q 'app.kubernetes.io/component: chaincode' "${TMP_DIR}/production.yaml"
grep -A4 -F 'readinessProbe:' "${TMP_DIR}/production.yaml" | grep -Fq 'port: peer'
grep -q 'CORE_PEER_CHAINCODELISTENADDRESS' "${TMP_DIR}/production.yaml"
grep -q '/tls/tlsintermediatecerts' "${TMP_DIR}/production.yaml"
grep -q 'peer0.shared-fabric.svc.cluster.local:7051' "${TMP_DIR}/external-staging.yaml"
if grep -q 'app.kubernetes.io/component: peer' "${TMP_DIR}/external-staging.yaml"; then
  echo "external staging profile rendered a managed peer" >&2
  exit 1
fi

if grep -E '^[[:space:]]*image:' "${TMP_DIR}/production.yaml" | grep -vq '@sha256:'; then
  echo "production rendered a tag-only image" >&2
  exit 1
fi
if grep -q 'KEK_SECRET' "${TMP_DIR}/production.yaml"; then
  echo "production rendered forbidden local KEK custody" >&2
  exit 1
fi
if grep -q 'peer0.shared-fabric.svc.cluster.local' "${TMP_DIR}/production.yaml"; then
  echo "production rendered the staging peer" >&2
  exit 1
fi
if grep -Eq 'hostCredentialJwt|signedPdf|HostingServiceCredential' "${TMP_DIR}/production.yaml"; then
  echo "production rendered raw host-service evidence" >&2
  exit 1
fi

cp "${CHART}/ci/production-values.yaml" "${TMP_DIR}/missing-authorization.yaml"
sed -i.bak 's/existingSecret: host-authorization/existingSecret: ""/' "${TMP_DIR}/missing-authorization.yaml"
if helm template invalid "${CHART}" -f "${TMP_DIR}/missing-authorization.yaml" >/dev/null 2>&1; then
  echo "chart accepted production without an authorization Secret" >&2
  exit 1
fi

cp "${CHART}/ci/production-values.yaml" "${TMP_DIR}/invalid-tag.yaml"
sed -i.bak 's#@sha256:[0-9a-f]\{64\}#:latest#' "${TMP_DIR}/invalid-tag.yaml"
if helm template invalid "${CHART}" -f "${TMP_DIR}/invalid-tag.yaml" >/dev/null 2>&1; then
  echo "chart accepted a mutable production image" >&2
  exit 1
fi

cp "${CHART}/ci/production-values.yaml" "${TMP_DIR}/invalid-kek.yaml"
sed -i.bak 's/envelope: hashicorp-transit/envelope: local/' "${TMP_DIR}/invalid-kek.yaml"
if helm template invalid "${CHART}" -f "${TMP_DIR}/invalid-kek.yaml" >/dev/null 2>&1; then
  echo "chart accepted local KEK custody in production" >&2
  exit 1
fi

cp "${CHART}/ci/production-values.yaml" "${TMP_DIR}/invalid-placeholder.yaml"
perl -0pi -e 's/sha256:[0-9a-f]{64}/sha256:0000000000000000000000000000000000000000000000000000000000000000/' "${TMP_DIR}/invalid-placeholder.yaml"
if helm template invalid "${CHART}" -f "${TMP_DIR}/invalid-placeholder.yaml" >/dev/null 2>&1; then
  echo "chart accepted an unresolved zero digest placeholder" >&2
  exit 1
fi

cp "${CHART}/ci/local-host1-values.yaml" "${TMP_DIR}/invalid-local-mode.yaml"
sed -i.bak 's/networkMode: local-network/networkMode: test-network/' "${TMP_DIR}/invalid-local-mode.yaml"
if helm template invalid "${CHART}" -f "${TMP_DIR}/invalid-local-mode.yaml" >/dev/null 2>&1; then
  echo "chart accepted a local profile outside local-network" >&2
  exit 1
fi

cp "${CHART}/ci/staging-values.yaml" "${TMP_DIR}/invalid-staging-http.yaml"
sed -i.bak 's#publicUrl: https://#publicUrl: http://#' "${TMP_DIR}/invalid-staging-http.yaml"
if helm template invalid "${CHART}" -f "${TMP_DIR}/invalid-staging-http.yaml" >/dev/null 2>&1; then
  echo "chart accepted a non-HTTPS staging host URL" >&2
  exit 1
fi

echo "portable host Helm contract passed"
