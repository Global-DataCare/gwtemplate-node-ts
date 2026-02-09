#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_FABRIC_TEST:-}" || -z "${CA_URL:-}" || -z "${CA_ADMIN_USER:-}" || -z "${CA_ADMIN_PASS:-}" || -z "${ORDERER_HOST:-}" || -z "${PEER_HOST:-}" || -z "${OUT_DIR:-}" ]]; then
  echo "Missing env vars: K8S_NAMESPACE_FABRIC_TEST, CA_URL, CA_ADMIN_USER, CA_ADMIN_PASS, ORDERER_HOST, PEER_HOST, OUT_DIR"
  exit 1
fi

CA_SCHEME="${CA_SCHEME:-https}"
ORDERER_NAME="${ORDERER_NAME:-orderer0}"
ORDERER_PASS="${ORDERER_PASS:-ordererpw}"
PEER_NAME="${PEER_NAME:-peer0}"
PEER_PASS="${PEER_PASS:-peerpw}"
USE_ADMIN_IDENTITY="${USE_ADMIN_IDENTITY:-0}"

POD_NAME="fabric-ca-client-$(date +%s)"

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" run "${POD_NAME}" --image=hyperledger/fabric-ca:latest --command -- sleep 3600

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" wait --for=condition=Ready pod/"${POD_NAME}" --timeout=120s

TLS_ARG=""
if [[ -n "${CA_TLS_CERT:-}" ]]; then
  kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "mkdir -p /tls"
  kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" cp "${CA_TLS_CERT}" "${POD_NAME}:/tls/ca.pem"
  TLS_ARG="--tls.certfiles /tls/ca.pem"
fi

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out && fabric-ca-client enroll -u ${CA_SCHEME}://${CA_ADMIN_USER}:${CA_ADMIN_PASS}@${CA_URL} ${TLS_ARG}"

if [[ "${USE_ADMIN_IDENTITY}" != "1" ]]; then
  kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out && fabric-ca-client register --id.name ${ORDERER_NAME} --id.secret ${ORDERER_PASS} --id.type orderer ${TLS_ARG}"
  kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out && fabric-ca-client register --id.name ${PEER_NAME} --id.secret ${PEER_PASS} --id.type peer ${TLS_ARG}"
fi

ORDERER_USER="${ORDERER_NAME}"
ORDERER_SECRET="${ORDERER_PASS}"
PEER_USER="${PEER_NAME}"
PEER_SECRET="${PEER_PASS}"
if [[ "${USE_ADMIN_IDENTITY}" == "1" ]]; then
  ORDERER_USER="${CA_ADMIN_USER}"
  ORDERER_SECRET="${CA_ADMIN_PASS}"
  PEER_USER="${CA_ADMIN_USER}"
  PEER_SECRET="${CA_ADMIN_PASS}"
fi

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out/orderer && fabric-ca-client enroll -u ${CA_SCHEME}://${ORDERER_USER}:${ORDERER_SECRET}@${CA_URL} --csr.hosts ${ORDERER_HOST} ${TLS_ARG}"
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out/orderer && export FABRIC_CA_CLIENT_MSPDIR=tls && fabric-ca-client enroll -u ${CA_SCHEME}://${ORDERER_USER}:${ORDERER_SECRET}@${CA_URL} --enrollment.profile tls --csr.hosts ${ORDERER_HOST} ${TLS_ARG}"

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out/peer && fabric-ca-client enroll -u ${CA_SCHEME}://${PEER_USER}:${PEER_SECRET}@${CA_URL} --csr.hosts ${PEER_HOST} ${TLS_ARG}"
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" exec "${POD_NAME}" -- sh -c "export FABRIC_CA_CLIENT_HOME=/out/peer && export FABRIC_CA_CLIENT_MSPDIR=tls && fabric-ca-client enroll -u ${CA_SCHEME}://${PEER_USER}:${PEER_SECRET}@${CA_URL} --enrollment.profile tls --csr.hosts ${PEER_HOST} ${TLS_ARG}"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" cp "${POD_NAME}:/out" "${OUT_DIR}"

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" delete pod "${POD_NAME}" --wait=false
