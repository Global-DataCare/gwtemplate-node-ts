#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_FABRIC_TEST:-}" ]]; then
  echo "Missing K8S_NAMESPACE_FABRIC_TEST. Source private-deploy.config first."
  exit 1
fi

kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" apply -f fabric-multicloud/k8s/couchdb.yaml
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" apply -f fabric-multicloud/k8s/fabric-ca-root.yaml
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" apply -f fabric-multicloud/k8s/fabric-ca-ica.yaml
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" apply -f fabric-multicloud/k8s/orderer.yaml
kubectl -n "${K8S_NAMESPACE_FABRIC_TEST}" apply -f fabric-multicloud/k8s/peer.yaml
