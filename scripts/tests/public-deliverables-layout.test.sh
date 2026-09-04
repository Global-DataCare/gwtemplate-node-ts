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
  EVIDENCE_REPRODUCIBLE_HOST_EN.md \
  ENTREGABLE_LOCAL_REPRODUCIBLE_ES.md \
  EVIDENCE_REPRODUCIBLE_LOCAL_EN.md \
  GUIA_OPERATIVA_HOST_ES.md \
  GUIDE_HOST_OPERATIONS_EN.md \
  GUIA_HOST_REPRODUCIBLE_ES.html \
  GUIA_HOST_REPRODUCIBLE_ES.docx \
  GUIDE_REPRODUCIBLE_HOST_EN.html \
  GUIDE_REPRODUCIBLE_HOST_EN.docx \
  MIGRACION_Y_DESPLIEGUE_ICA_ES.md \
  MIGRATION_AND_DEPLOYMENT_ICA_EN.md \
  PUESTA_EN_MARCHA_HOST_ES.md \
  PROCEDURE_HOST_ONBOARDING_EN.md \
  RESUMEN_OPERATIVO_Y_ENLACES_ES.md \
  REFERENCE_OPERATIONAL_SUMMARY_EN.md; do
  [[ -f "${ROOT}/deliverables/${document}" ]]
  grep -Fq "${document}" "${ROOT}/deliverables/README.md"
done
[[ -f "${ROOT}/deliverables/README_EN.md" ]]
grep -Fq 'README_EN.md' "${ROOT}/deliverables/README.md"
grep -Fq 'README.md' "${ROOT}/deliverables/README_EN.md"
grep -Fq 'deliverables/README.md' "${ROOT}/README.md"

grep -Fq '## Procedimiento completo de incorporación del host' \
  "${ROOT}/deliverables/PUESTA_EN_MARCHA_HOST_ES.md"
for document in \
  PUESTA_EN_MARCHA_HOST_ES.md \
  GUIA_OPERATIVA_HOST_ES.md \
  GUIA_HOST_REPRODUCIBLE_ES.html; do
  grep -Fq 'Nodo Operador' "${ROOT}/deliverables/${document}"
  rg -U -q 'Nodo\s+Operador,\s+que\s+actúa\s+como\s+Proveedor\s+de\s+Alojamiento' \
    "${ROOT}/deliverables/${document}"
  grep -Fq 'equipo DevOps del Nodo Operador' "${ROOT}/deliverables/${document}"
  grep -Fq 'entidad autorizada para administrar Fabric' "${ROOT}/deliverables/${document}"
  grep -Fq 'equipo DevOps de Fabric' "${ROOT}/deliverables/${document}"
  grep -Fq 'identidad registradora de la ICA de Fabric' "${ROOT}/deliverables/${document}"
  grep -Fq 'administrador del MSP' "${ROOT}/deliverables/${document}"
  grep -Fq 'son identidades diferentes' "${ROOT}/deliverables/${document}"
  grep -Fq 'identidades administrativas de Fabric' "${ROOT}/deliverables/${document}"
  grep -Fq 'Un grant temporal de enrolamiento no es un certificado.' \
    "${ROOT}/deliverables/${document}"
  grep -Fq 'La ICA de Fabric devuelve directamente los certificados al Nodo Operador.' \
    "${ROOT}/deliverables/${document}"
  grep -Fq 'sección 10.4' "${ROOT}/deliverables/${document}"
  grep -Fq 'sección 13.3' "${ROOT}/deliverables/${document}"
  if rg -U -n -i 'proveedor de servicios? de índice|\btenants?\b|proveedor\s+del\s+servicio\s+de\s+host|operador\s+del\s+host|operador\s+del\s+nodo\s+de\s+red|devops\s+del\s+host|responsable\s+del\s+host|operador\s+del\s+servicio|entidad\s+gobernadora|gobernanza\s+de\s+Fabric|Gobernanza\s+(confirma|aprueba)|autoridad\s+de\s+Fabric|Fase\s+A:\s+autoridad|administrador\s+de\s+Fabric' \
    "${ROOT}/deliverables/${document}"; then
    echo 'La guía del host se aparta de la terminología de Nodo Operador del Rulebook.' >&2
    exit 1
  fi
done

grep -Fq '## Complete host onboarding procedure' \
  "${ROOT}/deliverables/PROCEDURE_HOST_ONBOARDING_EN.md"
for document in \
  PROCEDURE_HOST_ONBOARDING_EN.md \
  GUIDE_HOST_OPERATIONS_EN.md \
  GUIDE_REPRODUCIBLE_HOST_EN.html; do
  grep -Fq 'Node Operator' "${ROOT}/deliverables/${document}"
  rg -U -q 'Node\s+Operator,\s+acting\s+as\s+a\s+Hosting\s+Provider' \
    "${ROOT}/deliverables/${document}"
  grep -Fq 'Node Operator DevOps team' "${ROOT}/deliverables/${document}"
  grep -Fq 'entity authorized to administer Fabric' "${ROOT}/deliverables/${document}"
  grep -Fq 'Fabric DevOps team' "${ROOT}/deliverables/${document}"
  grep -Fq 'Fabric ICA registrar identity' "${ROOT}/deliverables/${document}"
  grep -Fq 'MSP administrator' "${ROOT}/deliverables/${document}"
  grep -Fq 'are different identities' "${ROOT}/deliverables/${document}"
  grep -Fq 'Fabric administrative identities' "${ROOT}/deliverables/${document}"
  grep -Fq 'A temporary enrollment grant is not a certificate.' \
    "${ROOT}/deliverables/${document}"
  grep -Fq 'The Fabric ICA returns the certificates directly to the Node Operator.' \
    "${ROOT}/deliverables/${document}"
  grep -Fq 'section 10.4' "${ROOT}/deliverables/${document}"
  grep -Fq 'section 13.3' "${ROOT}/deliverables/${document}"
done
if rg -n 'ZXQGDC|Operator Node|[áéíóúñÁÉÍÓÚÑ¿¡]|\b(Entorno|Dominio|Jurisdicción|Contexto|Razón|País|Aprobación|Autorización|Enrolamiento)\b' \
  "${ROOT}/deliverables" --glob '*_EN.md' --glob '*_EN.html'; then
  echo 'An English deliverable contains untranslated or generated placeholder text.' >&2
  exit 1
fi
if rg -U -n -i 'proveedor\s+del\s+servicio\s+de\s+host|operador\s+del\s+host|operador\s+del\s+nodo\s+de\s+red|devops\s+del\s+host|responsable\s+del\s+host|operador\s+del\s+servicio|entidad\s+gobernadora|gobernanza\s+de\s+Fabric|Gobernanza\s+(confirma|aprueba)|autoridad\s+de\s+Fabric|Fase\s+A:\s+autoridad|administrador\s+de\s+Fabric|identidad\s+administradora\s+del\s+MSP|identidad\s+administrativa\s+del\s+MSP' \
  "${ROOT}/deliverables" --glob '*.md' --glob '*.html'; then
  echo 'Los entregables públicos contienen nombres antiguos o ambiguos para los responsables.' >&2
  exit 1
fi
if rg -n -i 'identidad administradora de Fabric CA|identidad registradora de Fabric CA|registrador de Fabric CA' \
  "${ROOT}/deliverables"; then
  echo 'La documentación confunde el software Fabric CA con la ICA de Fabric.' >&2
  exit 1
fi
if rg -n -i 'Flujo completo en lenguaje directo|El flujo ya no requiere un `did\.json` previo|`did\.json` provisional|did\.json.*provisional|provisional.*did\.json|viernes a lunes|ENROLLMENT_GRANT_TTL_SECONDS|\bauditor\b' \
  "${ROOT}/deliverables"; then
  echo 'La guía final contiene lenguaje informal o histórico.' >&2
  exit 1
fi

for document in \
  PUESTA_EN_MARCHA_HOST_ES.md \
  GUIA_OPERATIVA_HOST_ES.md \
  GUIA_HOST_REPRODUCIBLE_ES.html \
  RESUMEN_OPERATIVO_Y_ENLACES_ES.md; do
  for handoff_file in \
    peer-enrollment-grant.json \
    gw-client-enrollment-grant.json \
    fabric-ica-ca-chain.pem \
    fabric-endpoints.json \
    authorization.json \
    host-apply-confirmation.json \
    onboarding.host.json \
    manifest.sha256; do
    grep -Fq "${handoff_file}" "${ROOT}/deliverables/${document}"
  done
done

for document in \
  PROCEDURE_HOST_ONBOARDING_EN.md \
  GUIDE_HOST_OPERATIONS_EN.md \
  GUIDE_REPRODUCIBLE_HOST_EN.html \
  REFERENCE_OPERATIONAL_SUMMARY_EN.md; do
  for handoff_file in \
    peer-enrollment-grant.json \
    gw-client-enrollment-grant.json \
    fabric-ica-ca-chain.pem \
    fabric-endpoints.json \
    authorization.json \
    host-apply-confirmation.json \
    onboarding.host.json \
    manifest.sha256; do
    grep -Fq "${handoff_file}" "${ROOT}/deliverables/${document}"
  done
done

docx_xml="$(mktemp)"
trap 'rm -f "${docx_xml}"' EXIT
unzip -p "${ROOT}/deliverables/GUIA_HOST_REPRODUCIBLE_ES.docx" word/document.xml > "${docx_xml}"
for handoff_file in \
  peer-enrollment-grant.json \
  gw-client-enrollment-grant.json \
  fabric-ica-ca-chain.pem \
  fabric-endpoints.json \
  authorization.json \
  host-apply-confirmation.json \
  onboarding.host.json \
  manifest.sha256; do
  grep -Fq "${handoff_file}" "${docx_xml}"
done

unzip -p "${ROOT}/deliverables/GUIDE_REPRODUCIBLE_HOST_EN.docx" word/document.xml > "${docx_xml}"
for handoff_file in \
  peer-enrollment-grant.json \
  gw-client-enrollment-grant.json \
  fabric-ica-ca-chain.pem \
  fabric-endpoints.json \
  authorization.json \
  host-apply-confirmation.json \
  onboarding.host.json \
  manifest.sha256; do
  grep -Fq "${handoff_file}" "${docx_xml}"
done

if rg -n '/Users/[^/[:space:]]+/|/home/[^/[:space:]]+/' "${ROOT}/deliverables"; then
  echo 'A public deliverable contains a personal absolute path.' >&2
  exit 1
fi
