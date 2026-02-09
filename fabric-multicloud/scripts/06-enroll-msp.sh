#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CA_URL:-}" || -z "${CA_TLS_CERT:-}" || -z "${CA_ADMIN_USER:-}" || -z "${CA_ADMIN_PASS:-}" || -z "${ORDERER_HOST:-}" || -z "${PEER_HOST:-}" || -z "${OUT_DIR:-}" ]]; then
  echo "Missing env vars: CA_URL, CA_TLS_CERT, CA_ADMIN_USER, CA_ADMIN_PASS, ORDERER_HOST, PEER_HOST, OUT_DIR"
  exit 1
fi

ORDERER_NAME="${ORDERER_NAME:-orderer0}"
ORDERER_PASS="${ORDERER_PASS:-ordererpw}"
PEER_NAME="${PEER_NAME:-peer0}"
PEER_PASS="${PEER_PASS:-peerpw}"

run_client() {
  if command -v fabric-ca-client >/dev/null 2>&1; then
    fabric-ca-client "$@"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "fabric-ca-client not found and docker is not available."
    exit 1
  fi

  docker run --rm \
    -v "${OUT_DIR}:/out" \
    -v "${CA_TLS_CERT}:/tls/ca.pem:ro" \
    -e FABRIC_CA_CLIENT_HOME=/out \
    hyperledger/fabric-ca:latest \
    fabric-ca-client "$@"
}

mkdir -p "${OUT_DIR}"

export FABRIC_CA_CLIENT_HOME="${OUT_DIR}"

run_client enroll -u "https://${CA_ADMIN_USER}:${CA_ADMIN_PASS}@${CA_URL}" --tls.certfiles /tls/ca.pem

run_client register --id.name "${ORDERER_NAME}" --id.secret "${ORDERER_PASS}" --id.type orderer --tls.certfiles /tls/ca.pem
run_client register --id.name "${PEER_NAME}" --id.secret "${PEER_PASS}" --id.type peer --tls.certfiles /tls/ca.pem

mkdir -p "${OUT_DIR}/orderer/msp" "${OUT_DIR}/orderer/tls"
FABRIC_CA_CLIENT_HOME="${OUT_DIR}/orderer" run_client enroll \
  -u "https://${ORDERER_NAME}:${ORDERER_PASS}@${CA_URL}" \
  --csr.hosts "${ORDERER_HOST}" \
  --tls.certfiles /tls/ca.pem

FABRIC_CA_CLIENT_HOME="${OUT_DIR}/orderer" run_client enroll \
  -u "https://${ORDERER_NAME}:${ORDERER_PASS}@${CA_URL}" \
  --enrollment.profile tls \
  --csr.hosts "${ORDERER_HOST}" \
  --tls.certfiles /tls/ca.pem

mkdir -p "${OUT_DIR}/peer/msp" "${OUT_DIR}/peer/tls"
FABRIC_CA_CLIENT_HOME="${OUT_DIR}/peer" run_client enroll \
  -u "https://${PEER_NAME}:${PEER_PASS}@${CA_URL}" \
  --csr.hosts "${PEER_HOST}" \
  --tls.certfiles /tls/ca.pem

FABRIC_CA_CLIENT_HOME="${OUT_DIR}/peer" run_client enroll \
  -u "https://${PEER_NAME}:${PEER_PASS}@${CA_URL}" \
  --enrollment.profile tls \
  --csr.hosts "${PEER_HOST}" \
  --tls.certfiles /tls/ca.pem
