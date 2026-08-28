#!/usr/bin/env bash
# Flow contract:
# 1. Every public deliverable lives under deliverables/ and is indexed there.
# 2. The repository root links to that single public entry point.
# Authorization invariant: provider-private inventories never enter public deliverables.
# Persistence invariant: generated documents contain no developer-home paths.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

[[ ! -e "${ROOT}/ENTREGABLE-HOST-REPRODUCIBLE.md" ]]
for document in \
  ENTREGABLE_HOST_REPRODUCIBLE_ES.md \
  GUIA_OPERATIVA_HOST_ES.md \
  GUIA_HOST_REPRODUCIBLE_ES.html \
  GUIA_HOST_REPRODUCIBLE_ES.docx; do
  [[ -f "${ROOT}/deliverables/${document}" ]]
  grep -Fq "${document}" "${ROOT}/deliverables/README.md"
done
grep -Fq 'deliverables/README.md' "${ROOT}/README.md"

if rg -n '/Users/[^/[:space:]]+/|/home/[^/[:space:]]+/' "${ROOT}/deliverables"; then
  echo 'A public deliverable contains a personal absolute path.' >&2
  exit 1
fi
