#!/usr/bin/env bash
set -euo pipefail

confirm() {
  local msg="$1"
  read -r -p "${msg} (y/N): " answer
  [[ "${answer}" == "y" || "${answer}" == "Y" ]]
}

if command -v k3d >/dev/null 2>&1; then
  CLUSTER="${K3D_CLUSTER:-gdc-test}"
  echo "Detected k3d. Target cluster: ${CLUSTER}"
  confirm "Proceed with k3d" || exit 1
  k3d cluster list | grep -q "${CLUSTER}" || k3d cluster create "${CLUSTER}"
  kubectl config use-context "k3d-${CLUSTER}"
  kubectl get nodes
  exit 0
fi

if command -v minikube >/dev/null 2>&1; then
  PROFILE="${MINIKUBE_PROFILE:-gdc-test}"
  DRIVER="${MINIKUBE_DRIVER:-docker}"
  CPUS="${MINIKUBE_CPUS:-4}"
  MEMORY="${MINIKUBE_MEMORY:-8192}"

  echo "Detected minikube. Profile: ${PROFILE}, driver: ${DRIVER}, cpus: ${CPUS}, memory: ${MEMORY}MB"
  confirm "Proceed with minikube" || exit 1
  minikube start -p "${PROFILE}" --driver="${DRIVER}" --cpus="${CPUS}" --memory="${MEMORY}"
  minikube profile "${PROFILE}"
  minikube kubectl -- get nodes
  exit 0
fi

echo "No local Kubernetes found. Install k3d or minikube first."
exit 1
