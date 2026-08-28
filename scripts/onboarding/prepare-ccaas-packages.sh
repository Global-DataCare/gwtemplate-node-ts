#!/usr/bin/env bash
# Builds the deterministic CCAAS packages whose IDs must be placed in private
# Helm values and in the signed governance decision. Packages contain only the
# public Service address; they never contain credentials.
set -euo pipefail

for variable in HOST_FULLNAME KUBE_NAMESPACE CCAAS_IMAGE CCAAS_OUTPUT_DIR; do
  [[ -n "${!variable:-}" ]] || {
    echo "Missing ${variable}" >&2
    exit 1
  }
done
for label in "${HOST_FULLNAME}" "${KUBE_NAMESPACE}"; do
  [[ "${label}" =~ ^[a-z0-9]([-a-z0-9]*[a-z0-9])?$ ]] || {
    echo "HOST_FULLNAME and KUBE_NAMESPACE must be DNS labels" >&2
    exit 1
  }
done
[[ "${CCAAS_IMAGE}" =~ ^[^[:space:]@]+@sha256:[a-f0-9]{64}$ ]] || {
  echo "CCAAS_IMAGE must be an immutable OCI digest" >&2
  exit 1
}
[[ ! -e "${CCAAS_OUTPUT_DIR}" ]] || {
  echo "CCAAS_OUTPUT_DIR already exists; refusing to overwrite packages" >&2
  exit 1
}

IDENTITY_GLOBAL_CHANNEL="${IDENTITY_GLOBAL_CHANNEL:-identity-global}"
IDENTITY_ORGANIZATION_CHANNEL="${IDENTITY_ORGANIZATION_CHANNEL:-identity-eu}"
DATA_CHANNEL="${DATA_CHANNEL:-health-care-eu}"
specs=(
  "organization-sc|${IDENTITY_ORGANIZATION_CHANNEL}"
  "cryptographickey-sc|${IDENTITY_GLOBAL_CHANNEL},${IDENTITY_ORGANIZATION_CHANNEL}"
  "employee-sc|${IDENTITY_ORGANIZATION_CHANNEL}"
  "evidence-sc|${IDENTITY_GLOBAL_CHANNEL},${IDENTITY_ORGANIZATION_CHANNEL}"
  "credential-sc|${IDENTITY_GLOBAL_CHANNEL},${IDENTITY_ORGANIZATION_CHANNEL}"
  "artifact-sc|${IDENTITY_GLOBAL_CHANNEL},${IDENTITY_ORGANIZATION_CHANNEL}"
  "artifactevent-sc|${IDENTITY_GLOBAL_CHANNEL},${IDENTITY_ORGANIZATION_CHANNEL}"
  "subjectkeybinding-sc|${IDENTITY_GLOBAL_CHANNEL},${IDENTITY_ORGANIZATION_CHANNEL}"
  "consentaccess-sc|${DATA_CHANNEL}"
)

mkdir -p "${CCAAS_OUTPUT_DIR}/packages"
printf 'chaincodes:\n' > "${CCAAS_OUTPUT_DIR}/chaincodes.values.yaml"
: > "${CCAAS_OUTPUT_DIR}/manifest.tsv"

for spec in "${specs[@]}"; do
  IFS='|' read -r name channels <<< "${spec}"
  label="${name}-v1"
  address="${HOST_FULLNAME}-cc-${name}.${KUBE_NAMESPACE}.svc.cluster.local:9999"
  package_root="${CCAAS_OUTPUT_DIR}/packages/${name}"
  archive="${CCAAS_OUTPUT_DIR}/packages/${name}.tgz"
  mkdir -p "${package_root}/code"
  jq -cn --arg address "${address}" \
    '{address:$address,dial_timeout:"10s",tls_required:false}' \
    > "${package_root}/code/connection.json"
  jq -cn --arg label "${label}" '{path:"",type:"ccaas",label:$label}' \
    > "${package_root}/metadata.json"
  touch -t 198001010000 "${package_root}/code/connection.json" "${package_root}/metadata.json"
  COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 \
    -C "${package_root}/code" -cf - connection.json | gzip -n > "${package_root}/code.tar.gz"
  touch -t 198001010000 "${package_root}/code.tar.gz"
  COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 \
    -C "${package_root}" -cf - metadata.json code.tar.gz | gzip -n > "${archive}"
  digest="$(shasum -a 256 "${archive}" | awk '{print $1}')"
  package_id="${label}:${digest}"
  printf '  - name: %s\n    image: %s\n    packageId: %s\n' \
    "${name}" "${CCAAS_IMAGE}" "${package_id}" >> "${CCAAS_OUTPUT_DIR}/chaincodes.values.yaml"
  printf '%s\t%s\t%s\t%s\n' \
    "${name}" "${channels}" "packages/${name}.tgz" "${package_id}" \
    >> "${CCAAS_OUTPUT_DIR}/manifest.tsv"
done

(
  cd "${CCAAS_OUTPUT_DIR}"
  find packages -type f -name '*.tgz' -print | LC_ALL=C sort | xargs shasum -a 256 \
    > manifest.sha256
  shasum -a 256 chaincodes.values.yaml manifest.tsv >> manifest.sha256
)
echo "Nine deterministic CCAAS packages written to ${CCAAS_OUTPUT_DIR}." >&2
