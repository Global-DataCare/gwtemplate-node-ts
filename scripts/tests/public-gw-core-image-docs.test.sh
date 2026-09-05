# Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
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
PUBLIC_IMAGE="ghcr.io/global-datacare/gw-core@sha256:e08eb3482e8e6df812269ba72c14d7831c2cdc331fe7bc6836a606b4e2e96a71"
CCAAS_PACKAGE_PAGE="https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime"
CCAAS_IMAGE="ghcr.io/global-datacare/host-runtime@sha256:0742ce44f2c56b8a559ed872620c779adaac64c6e1b476d3fda1762f0d2fe510"

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

grep -Fq 'open-source host profile uses PostgreSQL for structured persistence and IPFS' "$ROOT_DIR/README.md"
grep -Fq 'through a private Kubo node for blob storage.' "$ROOT_DIR/README.md"
grep -Fq 'The Kubo API must remain private' "$ROOT_DIR/README.md"
grep -Fq 'available only as a legacy/demo compatibility profile.' "$ROOT_DIR/README.md"
if grep -Eiq 'docs-internal|roadmap|pending compatibility TODO' "$ROOT_DIR/README.md"; then
  echo 'Public package README must not expose obsolete planning documents.' >&2
  exit 1
fi
for obsolete_path in \
  docs-internal \
  data/animal-index-collaboration \
  jwks.json; do
  if [[ -e "$ROOT_DIR/$obsolete_path" ]]; then
    echo "Obsolete or use-case-specific residue must not remain in GW CORE: $obsolete_path" >&2
    exit 1
  fi
done

if rg -n 'docs-internal/' \
  "$ROOT_DIR/docs-end" \
  "$ROOT_DIR/scripts" \
  --glob '!public-gw-core-image-docs.test.sh'; then
  echo 'Public documentation and scripts must not point to removed internal files.' >&2
  exit 1
fi
grep -Fq 'CCAAS' "$ROOT_DIR/deliverables/GUIA_OPERATIVA_HOST_ES.md"
grep -Fq 'GW CORE y CCAAS son artefactos OCI distintos' "$ROOT_DIR/deliverables/GUIA_OPERATIVA_HOST_ES.md"
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq 'e08eb3482e8e6df812269ba72c14d7831c2cdc331fe7bc6836a606b4e2e96a71'
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq '0742ce44f2c56b8a559ed872620c779adaac64c6e1b476d3fda1762f0d2fe510'
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq "$PACKAGE_PAGE"
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq "$CCAAS_PACKAGE_PAGE"

grep -Fq 'https://github.com/orgs/Global-DataCare/packages/container/package/dataspace-ica' \
  "$ROOT_DIR/deliverables/MIGRACION_Y_DESPLIEGUE_ICA_ES.md"
grep -Fq 'ghcr.io/global-datacare/dataspace-ica@sha256:2e0faee426f7e1c438409a99ae2ab61f4aa21fc1ef615de3928ee1c020092053' \
  "$ROOT_DIR/deliverables/MIGRACION_Y_DESPLIEGUE_ICA_ES.md"

echo "Public GW CORE image documentation contract: ok"
