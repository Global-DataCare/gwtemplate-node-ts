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
PUBLIC_IMAGE="ghcr.io/global-datacare/gw-core@sha256:915069bc437e625e2444971191dec48e9c7b4cd65e04900612d8333af1daefa8"
CCAAS_PACKAGE_PAGE="https://github.com/orgs/Global-DataCare/packages/container/package/host-runtime"
CCAAS_IMAGE="ghcr.io/global-datacare/host-runtime@sha256:f5d45cebaa5e7443ebf70aac85f33794d3d366dcb5370ab7921e9bc56336c0fa"

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
# The Word report is a versioned audit snapshot, not a mutable pointer updated
# for every candidate patch. It must pin an immutable GW digest, while the text
# sources above pin the currently promoted public baseline exactly.
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Eq 'ghcr\.io/global-datacare/gw-core@sha256:[0-9a-f]{64}'
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq 'f5d45cebaa5e7443ebf70aac85f33794d3d366dcb5370ab7921e9bc56336c0fa'
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq "$PACKAGE_PAGE"
unzip -p "$ROOT_DIR/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml \
  | grep -Fq "$CCAAS_PACKAGE_PAGE"

for relative_path in \
  charts/gdc-host/README.md \
  deliverables/GUIA_OPERATIVA_HOST_ES.md \
  deliverables/GUIDE_HOST_OPERATIONS_EN.md \
  deliverables/GUIA_HOST_REPRODUCIBLE_ES.html \
  deliverables/GUIDE_REPRODUCIBLE_HOST_EN.html; do
  grep -Fq 'gdc-cc-organization-sc:9999' "$ROOT_DIR/$relative_path"
  if grep -Eq 'HOST_FULLNAME=.*CCAAS|accuro-cc-|host-specific CCAAS|por release Helm' \
    "$ROOT_DIR/$relative_path"; then
    echo "CCAAS documentation must keep package IDs host-neutral: $relative_path" >&2
    exit 1
  fi
done

grep -Fq 'https://github.com/orgs/Global-DataCare/packages/container/package/dataspace-ica' \
  "$ROOT_DIR/deliverables/MIGRACION_Y_DESPLIEGUE_ICA_ES.md"
grep -Fq 'ghcr.io/global-datacare/dataspace-ica@sha256:2e0faee426f7e1c438409a99ae2ab61f4aa21fc1ef615de3928ee1c020092053' \
  "$ROOT_DIR/deliverables/MIGRACION_Y_DESPLIEGUE_ICA_ES.md"

echo "Public GW CORE image documentation contract: ok"
