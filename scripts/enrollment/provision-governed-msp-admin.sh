#!/usr/bin/env bash
# Provisions one MSP administrator under network-governance custody and exports
# only the public MSP definition needed for channel admission.
set -euo pipefail

for variable in AUTHORIZATION_JSON CA_URL CA_ADMIN_HOME MSP_ADMIN_OUTPUT_DIR MSP_PUBLIC_OUTPUT_DIR; do
  [[ -n "${!variable:-}" ]] || {
    echo "Missing ${variable}" >&2
    exit 1
  }
done
for executable in fabric-ca-client jq openssl shasum; do
  command -v "${executable}" >/dev/null || {
    echo "Missing executable: ${executable}" >&2
    exit 1
  }
done

authorized="$(jq -r '.authorized // false' "${AUTHORIZATION_JSON}")"
host_url="$(jq -r '.hostUrl // empty' "${AUTHORIZATION_JSON}")"
msp_id="$(jq -r '.mspId // empty' "${AUTHORIZATION_JSON}")"
credential_id="$(jq -r '.hostCredentialId // empty' "${AUTHORIZATION_JSON}")"
network_kind="$(jq -r '.networkKind // empty' "${AUTHORIZATION_JSON}")"
if [[ "${authorized}" != true || -z "${host_url}" || -z "${msp_id}" \
  || -z "${credential_id}" || -z "${network_kind}" ]]; then
  echo 'Authorization JSON is incomplete or not authorized' >&2
  exit 1
fi
[[ "${msp_id}" =~ ^[A-Z][A-Z0-9]*MSP$ ]] || {
  echo 'Governance-assigned mspId must match ^[A-Z][A-Z0-9]*MSP$' >&2
  exit 1
}
if [[ -e "${MSP_ADMIN_OUTPUT_DIR}" || -e "${MSP_PUBLIC_OUTPUT_DIR}" ]]; then
  [[ -d "${MSP_ADMIN_OUTPUT_DIR}/msp/keystore" \
    && -s "${MSP_ADMIN_OUTPUT_DIR}/msp/signcerts/cert.pem" \
    && -s "${MSP_PUBLIC_OUTPUT_DIR}/admincerts/admin-cert.pem" \
    && -s "${MSP_PUBLIC_OUTPUT_DIR}/msp-metadata.json" ]] || {
    echo 'Existing governed MSP custody is incomplete; refusing partial reuse' >&2
    exit 1
  }
  jq -e --arg mspId "${msp_id}" --arg networkKind "${network_kind}" \
    --arg caName "${CA_NAME:-}" '
      .mspId == $mspId and .networkKind == $networkKind and .caName == $caName and
      .governanceManaged == true
    ' "${MSP_PUBLIC_OUTPUT_DIR}/msp-metadata.json" >/dev/null || {
    echo 'Existing governed MSP custody does not match mspId, network or Fabric CA' >&2
    exit 1
  }
  echo "Reusing governed ${msp_id} administrator from ${MSP_ADMIN_OUTPUT_DIR}." >&2
  exit 0
fi

enrollment_id="${MSP_ADMIN_ENROLLMENT_ID:-msp-admin-$(printf '%s' "${msp_id}:${network_kind}" | shasum -a 256 | cut -c1-20)}"
enrollment_secret="${MSP_ADMIN_ENROLLMENT_SECRET:-$(openssl rand -base64 36 | tr -d '=+/\n' | cut -c1-32)}"
export FABRIC_CA_CLIENT_HOME="${CA_ADMIN_HOME}"
register_args=(-u "${CA_URL}" \
  --id.name "${enrollment_id}" --id.secret "${enrollment_secret}" \
  --id.type admin --id.maxenrollments 1 \
  --id.attrs "gdc.mspId=${msp_id}:ecert")
[[ -z "${CA_TLS_CERT:-}" ]] || register_args+=(--tls.certfiles "${CA_TLS_CERT}")
[[ -z "${CA_NAME:-}" ]] || register_args+=(--caname "${CA_NAME}")
fabric-ca-client register "${register_args[@]}"

umask 077
mkdir -p "${MSP_ADMIN_OUTPUT_DIR}"
chmod 700 "${MSP_ADMIN_OUTPUT_DIR}"
ca_scheme="${CA_URL%%://*}"
ca_authority="${CA_URL#*://}"
export FABRIC_CA_CLIENT_HOME="${MSP_ADMIN_OUTPUT_DIR}"
enroll_args=(-u "${ca_scheme}://${enrollment_id}:${enrollment_secret}@${ca_authority%/}")
[[ -z "${CA_TLS_CERT:-}" ]] || enroll_args+=(--tls.certfiles "${CA_TLS_CERT}")
[[ -z "${CA_NAME:-}" ]] || enroll_args+=(--caname "${CA_NAME}")
fabric-ca-client enroll "${enroll_args[@]}"
unset enrollment_secret MSP_ADMIN_ENROLLMENT_SECRET

admin_msp="${MSP_ADMIN_OUTPUT_DIR}/msp"
admin_certificate="$(find "${admin_msp}/signcerts" -maxdepth 1 -type f -print -quit)"
[[ -n "${admin_certificate}" ]] || {
  echo 'Fabric CA did not return an MSP administrator certificate' >&2
  exit 1
}

mkdir -p "${MSP_PUBLIC_OUTPUT_DIR}/admincerts"
for directory in cacerts intermediatecerts tlscacerts tlsintermediatecerts; do
  if [[ -d "${admin_msp}/${directory}" ]]; then
    mkdir -p "${MSP_PUBLIC_OUTPUT_DIR}/${directory}"
    cp "${admin_msp}/${directory}/"* "${MSP_PUBLIC_OUTPUT_DIR}/${directory}/"
  fi
done
cp "${admin_certificate}" "${MSP_PUBLIC_OUTPUT_DIR}/admincerts/admin-cert.pem"

node_ou_certificate="$(find "${MSP_PUBLIC_OUTPUT_DIR}/intermediatecerts" -maxdepth 1 -type f -print -quit 2>/dev/null || true)"
if [[ -z "${node_ou_certificate}" ]]; then
  node_ou_certificate="$(find "${MSP_PUBLIC_OUTPUT_DIR}/cacerts" -maxdepth 1 -type f -print -quit)"
fi
node_ou_relative="${node_ou_certificate#${MSP_PUBLIC_OUTPUT_DIR}/}"
cat > "${MSP_PUBLIC_OUTPUT_DIR}/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: ${node_ou_relative}
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: ${node_ou_relative}
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: ${node_ou_relative}
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: ${node_ou_relative}
    OrganizationalUnitIdentifier: orderer
EOF

jq -n --arg mspId "${msp_id}" --arg networkKind "${network_kind}" \
  --arg caName "${CA_NAME:-}" \
  '{specVersion:"gdc.fabric.public-msp-definition/v1",mspId:$mspId,
    networkKind:$networkKind,caName:$caName,governanceManaged:true}' \
  > "${MSP_PUBLIC_OUTPUT_DIR}/msp-metadata.json"
(
  cd "${MSP_PUBLIC_OUTPUT_DIR}"
  find . -type f ! -name manifest.sha256 -print0 | sort -z | xargs -0 shasum -a 256 > manifest.sha256
)
chmod -R go-w "${MSP_PUBLIC_OUTPUT_DIR}"
echo "Governed ${msp_id} administrator retained in ${MSP_ADMIN_OUTPUT_DIR}; public MSP definition written to ${MSP_PUBLIC_OUTPUT_DIR}." >&2
