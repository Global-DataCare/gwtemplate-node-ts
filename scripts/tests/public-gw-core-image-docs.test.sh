#!/usr/bin/env bash
# Flow contract:
# 1. Public project entry points identify the canonical GW CORE package page.
# 2. Operational examples pin the independently verified OCI manifest digest.
# 3. CCAAS remains a separate image/package lifecycle and never reuses GW CORE.
# Authorization invariant: documentation only advertises the published public artifact.
# Persistence invariant: deployment examples remain immutable and registry-portable.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PACKAGE_PAGE="https://github.com/orgs/Global-DataCare/packages/container/package/gw-core"
PUBLIC_IMAGE="ghcr.io/global-datacare/gw-core@sha256:6b37c7dfea17dc2ee42628c5467fb5b44fe7f669536e695bd4f2932714485e5f"
CCAAS_PACKAGE_PAGE="https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime"
CCAAS_IMAGE="ghcr.io/global-datacare/host-runtime@sha256:67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac"

for relative_path in \
  README.md \
  charts/gdc-host/README.md \
  deliverables/README.md \
  deliverables/ENTREGABLE_HOST_REPRODUCIBLE_ES.md \
  deliverables/GUIA_OPERATIVA_HOST_ES.md \
  deliverables/GUIA_HOST_REPRODUCIBLE_ES.html; do
  grep -Fq "$PACKAGE_PAGE" "$ROOT_DIR/$relative_path"
  grep -Fq "$PUBLIC_IMAGE" "$ROOT_DIR/$relative_path"
  grep -Fq "$CCAAS_PACKAGE_PAGE" "$ROOT_DIR/$relative_path"
  grep -Fq "$CCAAS_IMAGE" "$ROOT_DIR/$relative_path"
done

grep -Fq 'CCAAS' "$ROOT_DIR/deliverables/GUIA_OPERATIVA_HOST_ES.md"
grep -Fq 'GW CORE y CCAAS son artefactos OCI distintos' "$ROOT_DIR/deliverables/GUIA_OPERATIVA_HOST_ES.md"
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq '6b37c7dfea17dc2ee42628c5467fb5b44fe7f669536e695bd4f2932714485e5f'
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq '67e5c0fb93efbdc79812a3579ea0b9b0d8e230fca8d430c72e81666a7389f7ac'
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq "$PACKAGE_PAGE"
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq "$CCAAS_PACKAGE_PAGE"

echo "Public GW CORE image documentation contract: ok"
