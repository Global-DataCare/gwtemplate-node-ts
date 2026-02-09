#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_FABRIC_TEST:-}" || -z "${K8S_NAMESPACE_GDC_TEST:-}" ]]; then
  echo "Missing K8S_NAMESPACE_FABRIC_TEST or K8S_NAMESPACE_GDC_TEST. Source private-deploy.config first."
  exit 1
fi

create_ns() {
  local ns="$1"
  if [[ -n "${ns}" ]]; then
    kubectl get namespace "${ns}" >/dev/null 2>&1 || kubectl create namespace "${ns}"
  fi
}

create_ns "${K8S_NAMESPACE_FABRIC_TEST}"
create_ns "${K8S_NAMESPACE_GDC_TEST}"
create_ns "${K8S_NAMESPACE_FABRIC_PROD:-}"
create_ns "${K8S_NAMESPACE_GDC_PROD:-}"

# Switch default namespace for convenience
kubectl config set-context --current --namespace "${K8S_NAMESPACE_FABRIC_TEST}"
