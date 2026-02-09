#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_GDC:-}" ]]; then
  echo "Missing K8S_NAMESPACE_GDC. Source private-deploy.config first."
  exit 1
fi

echo "Deploy gdc host/connector manifests here (not included yet)."
