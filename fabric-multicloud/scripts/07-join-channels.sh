#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_FABRIC_TEST:-}" || -z "${ARTIFACTS_DIR:-}" ]]; then
  echo "Missing K8S_NAMESPACE_FABRIC_TEST or ARTIFACTS_DIR. Source private-deploy.config first."
  exit 1
fi

CHANNEL_BLOCKS_DIR="${ARTIFACTS_DIR}/channel-artifacts"
ICA_CA="${ARTIFACTS_DIR}/fabric-ca-server-ica/TAXES-G02793479_TEST-EUR-ICA_UNID_ONLINE/ca-cert.pem"
OSNADMIN_CERT="${ARTIFACTS_DIR}/enroll/osnadmin-tls/tls/signcerts/cert.pem"
OSNADMIN_KEY="$(ls "${ARTIFACTS_DIR}"/enroll/osnadmin-tls/tls/keystore/*_sk | head -n 1)"

if [[ ! -d "${CHANNEL_BLOCKS_DIR}" ]]; then
  echo "Missing channel blocks dir: ${CHANNEL_BLOCKS_DIR}"
  exit 1
fi
if [[ ! -f "${ICA_CA}" || ! -f "${OSNADMIN_CERT}" || ! -f "${OSNADMIN_KEY}" ]]; then
  echo "Missing osnadmin TLS material or ICA CA cert."
  exit 1
fi

TMP_CHAIN="/tmp/osnadmin-client-chain.pem"
cat "${OSNADMIN_CERT}" "${ICA_CA}" > "${TMP_CHAIN}"

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" delete configmap channel-blocks --ignore-not-found
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" create configmap channel-blocks \
  --from-file="${CHANNEL_BLOCKS_DIR}"

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" create secret generic osnadmin-tls \
  --from-file=client-chain.pem="${TMP_CHAIN}" \
  --from-file=client.key="${OSNADMIN_KEY}" \
  --from-file=ica-ca.pem="${ICA_CA}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" delete job osnadmin-join --ignore-not-found
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" delete job osnadmin-list --ignore-not-found
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" delete job peer-join --ignore-not-found

kubectl apply -f "${PWD}/fabric-multicloud/k8s/osnadmin-join-job.yaml"
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" wait --for=condition=complete job/osnadmin-join --timeout=600s
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" logs job/osnadmin-join --tail=50

kubectl apply -f "${PWD}/fabric-multicloud/k8s/osnadmin-list-job.yaml"
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" wait --for=condition=complete job/osnadmin-list --timeout=600s
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" logs job/osnadmin-list --tail=200

kubectl apply -f "${PWD}/fabric-multicloud/k8s/peer-join-job.yaml"
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" wait --for=condition=complete job/peer-join --timeout=600s
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" logs job/peer-join --tail=200
