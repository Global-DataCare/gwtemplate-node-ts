# Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
#!/usr/bin/env bash
set -euo pipefail

# Journey:
# 1. The public package identifies the exact OCI chart and immutable images.
# 2. The authority and provider execute separate, copyable command sequences.
# 3. The provider verifies Fabric ICA, enrolls MSP/TLS locally and installs Helm.
# 4. The authority closes the enrollment endpoint without stopping Fabric.
# Authorization invariant: provider material never includes a Fabric CA registrar.
# Persistence invariant: the host retains its own MSP/TLS, PVC and acceptance evidence.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUIDE="${ROOT}/deliverables/GUIA_OPERATIVA_HOST_ES.md"
INDEX="${ROOT}/deliverables/README.md"
CHART_README="${ROOT}/charts/gdc-host/README.md"
CHART_METADATA="${ROOT}/charts/gdc-host/Chart.yaml"

for file in "${GUIDE}" "${INDEX}" "${CHART_README}" "${CHART_METADATA}"; do
  test -f "${file}"
done

grep -Fq 'oci://ghcr.io/global-datacare/gdc-host' "${INDEX}"
grep -Fq 'helm pull oci://ghcr.io/global-datacare/gdc-host --version 0.3.2' "${GUIDE}"
grep -Fq 'peer.channels' "${GUIDE}"
grep -Fq 'fabric-ca-client getcainfo' "${GUIDE}"
grep -Fq 'enroll-host-msp.sh' "${GUIDE}"
grep -Fq 'enroll-host-client.sh' "${GUIDE}"
grep -Fq 'materialize-kubernetes-secrets.sh' "${GUIDE}"
grep -Fq 'helm upgrade --install' "${GUIDE}"
grep -Fq 'La identidad registradora de la ICA de Fabric nunca se entrega al proveedor' "${GUIDE}"
grep -Fq 'La ICA de Fabric no participa en el tráfico normal' "${GUIDE}"
grep -Fq 'org.opencontainers.image.source: https://github.com/Global-DataCare/gwtemplate-node-ts' "${CHART_METADATA}"

if rg -n '/Users/[^/[:space:]]+|34\.[0-9]+\.[0-9]+\.[0-9]+' "${ROOT}/deliverables"; then
  echo 'Public deliverables must not contain developer paths or concrete IPv4 addresses.' >&2
  exit 1
fi

echo 'public-host-provider-handoff.test.sh: PASS'
