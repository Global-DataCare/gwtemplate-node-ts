#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_FABRIC_TEST:-}" || -z "${ARTIFACTS_DIR:-}" ]]; then
  echo "Missing K8S_NAMESPACE_FABRIC_TEST or ARTIFACTS_DIR. Source private-deploy.config first."
  exit 1
fi

confirm() {
  local msg="$1"
  read -r -p "${msg} (y/N): " answer
  [[ "${answer}" == "y" || "${answer}" == "Y" ]]
}

require_dir() {
  local label="$1"
  local dir="$2"
  if [[ -z "${dir}" || ! -d "${dir}" ]]; then
    echo "Missing ${label} directory: ${dir}"
    exit 1
  fi
}

apply_secrets() {
  local ns="$1"
  local orderer_msp="$2"
  local orderer_tls="$3"
  local peer_msp="$4"
  local peer_tls="$5"
  local orderer_msp_tgz=""
  local orderer_tls_tgz=""
  local peer_msp_tgz=""
  local peer_tls_tgz=""

  require_dir "orderer MSP" "${orderer_msp}"
  require_dir "orderer TLS" "${orderer_tls}"
  require_dir "peer MSP" "${peer_msp}"
  require_dir "peer TLS" "${peer_tls}"

  if [[ -f "${orderer_msp}/msp.tgz" ]]; then
    orderer_msp_tgz="${orderer_msp}/msp.tgz"
  elif [[ -f "$(dirname "${orderer_msp}")/msp.tgz" ]]; then
    orderer_msp_tgz="$(dirname "${orderer_msp}")/msp.tgz"
  fi
  if [[ -f "${orderer_tls}/tls.tgz" ]]; then
    orderer_tls_tgz="${orderer_tls}/tls.tgz"
  elif [[ -f "$(dirname "${orderer_tls}")/tls.tgz" ]]; then
    orderer_tls_tgz="$(dirname "${orderer_tls}")/tls.tgz"
  fi
  if [[ -f "${peer_msp}/msp.tgz" ]]; then
    peer_msp_tgz="${peer_msp}/msp.tgz"
  elif [[ -f "$(dirname "${peer_msp}")/msp.tgz" ]]; then
    peer_msp_tgz="$(dirname "${peer_msp}")/msp.tgz"
  fi
  if [[ -f "${peer_tls}/tls.tgz" ]]; then
    peer_tls_tgz="${peer_tls}/tls.tgz"
  elif [[ -f "$(dirname "${peer_tls}")/tls.tgz" ]]; then
    peer_tls_tgz="$(dirname "${peer_tls}")/tls.tgz"
  fi

  echo "About to apply secrets in namespace: ${ns}"
  echo "  orderer MSP: ${orderer_msp_tgz:-${orderer_msp}}"
  echo "  orderer TLS: ${orderer_tls_tgz:-${orderer_tls}}"
  echo "  peer MSP:    ${peer_msp_tgz:-${peer_msp}}"
  echo "  peer TLS:    ${peer_tls_tgz:-${peer_tls}}"

  if ! confirm "Proceed"; then
    echo "Cancelled."
    exit 1
  fi

  if [[ -n "${orderer_msp_tgz}" ]]; then
    kubectl -n "${ns}" create secret generic orderer-msp --from-file=msp.tgz="${orderer_msp_tgz}" --dry-run=client -o yaml | kubectl apply -f -
  else
    kubectl -n "${ns}" create secret generic orderer-msp --from-file="${orderer_msp}" --dry-run=client -o yaml | kubectl apply -f -
  fi
  if [[ -n "${orderer_tls_tgz}" ]]; then
    kubectl -n "${ns}" create secret generic orderer-tls --from-file=tls.tgz="${orderer_tls_tgz}" --dry-run=client -o yaml | kubectl apply -f -
  else
    kubectl -n "${ns}" create secret generic orderer-tls --from-file="${orderer_tls}" --dry-run=client -o yaml | kubectl apply -f -
  fi
  if [[ -n "${peer_msp_tgz}" ]]; then
    kubectl -n "${ns}" create secret generic peer-msp --from-file=msp.tgz="${peer_msp_tgz}" --dry-run=client -o yaml | kubectl apply -f -
  else
    kubectl -n "${ns}" create secret generic peer-msp --from-file="${peer_msp}" --dry-run=client -o yaml | kubectl apply -f -
  fi
  if [[ -n "${peer_tls_tgz}" ]]; then
    kubectl -n "${ns}" create secret generic peer-tls --from-file=tls.tgz="${peer_tls_tgz}" --dry-run=client -o yaml | kubectl apply -f -
  else
    kubectl -n "${ns}" create secret generic peer-tls --from-file="${peer_tls}" --dry-run=client -o yaml | kubectl apply -f -
  fi
}

if [[ "${SKIP_FABRIC_MSP_SECRETS:-}" != "1" ]]; then
  if [[ -z "${ORDERER_MSP_DIR:-}" || -z "${ORDERER_TLS_DIR:-}" || -z "${PEER_MSP_DIR:-}" || -z "${PEER_TLS_DIR:-}" ]]; then
    echo "Missing orderer/peer MSP/TLS paths."
    exit 1
  fi
  apply_secrets "${K8S_NAMESPACE_FABRIC_TEST}" "${ORDERER_MSP_DIR}" "${ORDERER_TLS_DIR}" "${PEER_MSP_DIR}" "${PEER_TLS_DIR}"
else
  echo "Skipping orderer/peer MSP/TLS secrets (SKIP_FABRIC_MSP_SECRETS=1)."
fi

create_ca_secrets() {
  local ns="$1"
  local root_user="$2"
  local root_pass="$3"
  local ica_user="$4"
  local ica_pass="$5"
  local root_data="$6"
  local ica_data="$7"
  local root_cfg="$8"
  local ica_cfg="$9"

  require_dir "fabric-ca-root data" "${root_data}"
  require_dir "fabric-ca-ica data" "${ica_data}"
  if [[ ! -f "${root_cfg}" || ! -f "${ica_cfg}" ]]; then
    echo "Missing fabric-ca config file(s)."
    exit 1
  fi

  if [[ -z "${root_user}" || -z "${root_pass}" || -z "${ica_user}" || -z "${ica_pass}" ]]; then
    echo "Missing Fabric CA admin credentials."
    exit 1
  fi

  echo "About to apply Fabric CA secrets in namespace: ${ns}"
  echo "  root data: ${root_data}"
  echo "  ica data:  ${ica_data}"
  if ! confirm "Proceed with Fabric CA secrets"; then
    echo "Cancelled."
    exit 1
  fi

  kubectl -n "${ns}" create secret generic fabric-ca-root-admin \
    --from-literal=user="${root_user}" \
    --from-literal=password="${root_pass}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl -n "${ns}" create secret generic fabric-ca-ica-admin \
    --from-literal=user="${ica_user}" \
    --from-literal=password="${ica_pass}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl -n "${ns}" create secret generic fabric-ca-root-data \
    --from-file="${root_data}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl -n "${ns}" create secret generic fabric-ca-ica-data \
    --from-file="${ica_data}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl -n "${ns}" create secret generic fabric-ca-root-config \
    --from-file=fabric-ca-server-config.yaml="${root_cfg}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl -n "${ns}" create secret generic fabric-ca-ica-config \
    --from-file=fabric-ca-server-config.yaml="${ica_cfg}" \
    --dry-run=client -o yaml | kubectl apply -f -
}

if [[ -n "${FABRIC_CA_ROOT_DATA_DIR:-}" ]]; then
  create_ca_secrets \
    "${K8S_NAMESPACE_FABRIC_TEST}" \
    "${FABRIC_CA_ROOT_ADMIN_USER:-}" \
    "${FABRIC_CA_ROOT_ADMIN_PASS:-}" \
    "${FABRIC_CA_ICA_ADMIN_USER:-}" \
    "${FABRIC_CA_ICA_ADMIN_PASS:-}" \
    "${FABRIC_CA_ROOT_DATA_DIR:-}" \
    "${FABRIC_CA_ICA_DATA_DIR:-}" \
    "${FABRIC_CA_ROOT_CONFIG_FILE:-}" \
    "${FABRIC_CA_ICA_CONFIG_FILE:-}"
fi

if [[ -n "${COUCHDB_USER:-}" && -n "${COUCHDB_PASS:-}" ]]; then
  echo "About to apply CouchDB secrets in namespace: ${K8S_NAMESPACE_FABRIC_TEST}"
  if confirm "Proceed with CouchDB secrets"; then
    kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" create secret generic couchdb-auth \
      --from-literal=username="${COUCHDB_USER}" \
      --from-literal=password="${COUCHDB_PASS}" \
      --dry-run=client -o yaml | kubectl apply -f -
  else
    echo "Skipped CouchDB secrets."
  fi
fi

if [[ -n "${K8S_NAMESPACE_FABRIC_PROD:-}" ]]; then
  if [[ -z "${ORDERER_MSP_DIR_PROD:-}" || -z "${ORDERER_TLS_DIR_PROD:-}" || -z "${PEER_MSP_DIR_PROD:-}" || -z "${PEER_TLS_DIR_PROD:-}" ]]; then
    echo "Prod namespace set but prod MSP/TLS paths not defined."
    exit 1
  fi
  apply_secrets "${K8S_NAMESPACE_FABRIC_PROD}" "${ORDERER_MSP_DIR_PROD}" "${ORDERER_TLS_DIR_PROD}" "${PEER_MSP_DIR_PROD}" "${PEER_TLS_DIR_PROD}"
fi
