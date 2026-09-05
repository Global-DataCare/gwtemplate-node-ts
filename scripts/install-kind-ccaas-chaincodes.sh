#!/usr/bin/env bash
# Funciones del contrato CCAAS para la prueba kind/Helm.
# Este archivo se carga desde smoke-helm-local-network.sh; no administra la
# red ni crea identidades. Consume el peer, el administrador MSP y los canales
# que el flujo gobernado ya ha preparado.

KIND_CCAAS_SPECS=(
  'organization-sc|identity-local'
  'cryptographickey-sc|identity-local'
  'employee-sc|identity-local'
  'evidence-sc|identity-local'
  'credential-sc|identity-local'
  'artifact-sc|identity-local,health-care-local'
  'artifactevent-sc|identity-local'
  'subjectkeybinding-sc|identity-local'
  'consentaccess-sc|health-care-local'
)

require_kind_ccaas_context() {
  local variable
  for variable in ROOT TEMP_DIR CLUSTER_NAME KUBE_CONTEXT NAMESPACE KIND_PEER_SERVICE KIND_PEER_MSP_ID FABRIC_DEVNET_ROOT; do
    [[ -n "${!variable:-}" ]] || {
      echo "Falta la variable CCAAS requerida: ${variable}" >&2
      return 2
    }
  done
}

prepare_kind_ccaas_chaincodes() {
  require_kind_ccaas_context
  local spec name channel label service_address package_root
  local archive package_digest package_id image_tag image_id image_ref runtime_digest

  KIND_CCAAS_MANIFEST="${TEMP_DIR}/kind-ccaas-manifest.tsv"
  KIND_CCAAS_VALUES_FILE="${TEMP_DIR}/kind-ccaas-values.yaml"
  : > "${KIND_CCAAS_MANIFEST}"
  printf 'chaincodes:\n' > "${KIND_CCAAS_VALUES_FILE}"

  runtime_digest="$(
    find "${ROOT}/chaincode" -type f \
      \( -name 'index.js' -o -name 'package.json' -o -name 'package-lock.json' -o -path '*/lib/*.js' -o -name 'Dockerfile.ccaas' \) \
      -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}'
  )"
  image_tag="gdc-ccaas/host-runtime:local-${runtime_digest:0:12}"
  docker build --platform linux/amd64 \
    --file "${ROOT}/chaincode/Dockerfile.ccaas" \
    --tag "${image_tag}" \
    "${ROOT}/chaincode"
  kind load docker-image "${image_tag}" --name "${CLUSTER_NAME}"
  image_id="$(docker image inspect "${image_tag}" --format '{{.Id}}')"
  image_ref="registry.local.invalid/host-runtime@${image_id}"
  [[ "${image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    echo "Docker no registró la imagen CCAAS ${image_tag}." >&2
    return 1
  }

  for spec in "${KIND_CCAAS_SPECS[@]}"; do
    IFS='|' read -r name channel <<< "${spec}"
    label="${name}-kind-v1"
    service_address="host-evidence-cc-${name}:9999"
    package_root="${TEMP_DIR}/package-${name}"
    archive="${TEMP_DIR}/${name}-caas.tgz"
    rm -rf "${package_root}"
    mkdir -p "${package_root}/code"

    jq -cn --arg address "${service_address}" \
      '{address:$address,dial_timeout:"10s",tls_required:false}' \
      > "${package_root}/code/connection.json"
    jq -cn --arg label "${label}" \
      '{path:"",type:"ccaas",label:$label}' \
      > "${package_root}/metadata.json"
    touch -t 198001010000 "${package_root}/code/connection.json" "${package_root}/metadata.json"
    COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 \
      -C "${package_root}/code" -cf - connection.json \
      | gzip -n > "${package_root}/code.tar.gz"
    touch -t 198001010000 "${package_root}/code.tar.gz"
    COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 \
      -C "${package_root}" -cf - metadata.json code.tar.gz \
      | gzip -n > "${archive}"
    package_digest="$(shasum -a 256 "${archive}" | awk '{print $1}')"
    package_id="${label}:${package_digest}"

    cat >> "${KIND_CCAAS_VALUES_FILE}" <<EOF
  - name: ${name}
    image: ${image_ref}
    localImage: ${image_tag}
    imagePullPolicy: Never
    packageId: ${package_id}
EOF
    printf '%s\t%s\t%s\t%s\t%s\n' \
      "${name}" "${channel}" "${archive}" "${package_id}" "${image_ref}" \
      >> "${KIND_CCAAS_MANIFEST}"
  done
}

kind_peer_exec() {
  kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" exec peer-join-tools -- env \
    CORE_PEER_LOCALMSPID="${KIND_PEER_MSP_ID}" \
    CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
    CORE_PEER_ADDRESS="${KIND_PEER_SERVICE}:7051" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE=/tmp/peer-tls-root.pem \
    CORE_PEER_TLS_SERVERHOSTOVERRIDE="${KIND_PEER_SERVICE}" \
    "$@"
}

docker_peer_exec() {
  local msp_id="$1"
  local peer_address="$2"
  local domain="$3"
  shift 3
  docker exec -w /workspace "${FABRIC_TOOLS_CONTAINER}" env \
    CORE_PEER_LOCALMSPID="${msp_id}" \
    CORE_PEER_MSPCONFIGPATH="/workspace/organizations/peerOrganizations/${domain}/users/Admin@${domain}/msp" \
    CORE_PEER_ADDRESS="${peer_address}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="/workspace/organizations/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt" \
    "$@"
}

ensure_kind_package_installed() {
  local remote_archive="$1"
  local package_id="$2"
  if kind_peer_exec peer lifecycle chaincode queryinstalled | grep -Fq "${package_id}"; then
    return 0
  fi
  kind_peer_exec peer lifecycle chaincode install "${remote_archive}"
  kind_peer_exec peer lifecycle chaincode queryinstalled | grep -Fq "${package_id}"
}

ensure_docker_host2_package_installed() {
  local archive="$1"
  local docker_archive="$2"
  local package_id="$3"
  if docker_peer_exec Host2MSP peer0-host2:7051 host2.example.com \
    peer lifecycle chaincode queryinstalled | grep -Fq "${package_id}"; then
    return 0
  fi
  docker cp "${archive}" "${FABRIC_TOOLS_CONTAINER}:${docker_archive}"
  docker_peer_exec Host2MSP peer0-host2:7051 host2.example.com \
    peer lifecycle chaincode install "${docker_archive}"
  docker_peer_exec Host2MSP peer0-host2:7051 host2.example.com \
    peer lifecycle chaincode queryinstalled | grep -Fq "${package_id}"
}

wait_for_kind_chaincode_commit() {
  local channel="$1"
  local name="$2"
  local target_sequence="$3"
  local committed=''
  for _ in $(seq 1 "${KIND_PEER_SYNC_ATTEMPTS:-600}"); do
    committed="$(kind_peer_exec peer lifecycle chaincode querycommitted \
      --channelID "${channel}" --name "${name}" --output json 2>/dev/null || true)"
    if [[ "$(jq -r '.sequence // 0' <<< "${committed:-null}")" == "${target_sequence}" ]]; then
      printf '%s' "${committed}"
      return 0
    fi
    sleep 1
  done
  echo "El peer Kubernetes no sincronizó ${name} sequence ${target_sequence} en ${channel}." >&2
  return 1
}

wait_for_kind_committed_definition() {
  local channel="$1"
  local name="$2"
  local committed=''
  for _ in $(seq 1 "${KIND_PEER_SYNC_ATTEMPTS:-600}"); do
    committed="$(kind_peer_exec peer lifecycle chaincode querycommitted \
      --channelID "${channel}" --name "${name}" --output json 2>/dev/null || true)"
    if jq -e '(.sequence // 0) > 0' <<< "${committed:-null}" >/dev/null 2>&1; then
      printf '%s' "${committed}"
      return 0
    fi
    sleep 1
  done
  echo "El peer Kubernetes no sincronizó la definición inicial de ${name} en ${channel}." >&2
  return 1
}

install_kind_ccaas_chaincodes() {
  require_kind_ccaas_context
  [[ -s "${KIND_CCAAS_MANIFEST:-}" ]] || {
    echo 'No existe el manifiesto temporal de paquetes CCAAS.' >&2
    return 2
  }
  [[ -f "${ORDERER_TLS_CA_HOST:-}" ]] || {
    echo 'No existe el certificado TLS del orderer para el lifecycle CCAAS.' >&2
    return 2
  }

  kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" cp \
    "${ORDERER_TLS_CA_HOST}" peer-join-tools:/tmp/orderer-tls-ca.pem

  local name channel_csv channel archive package_id image_ref remote_archive approval
  local committed current_sequence target_sequence host1_approval host1_package_id host2_package_id
  local docker_archive
  local -a channels
  KIND_PEER_CCAAS_NAMES=''
  while IFS=$'\t' read -r name channel_csv archive package_id image_ref; do
    remote_archive="/tmp/${name}-caas.tgz"
    kubectl --context "${KUBE_CONTEXT}" -n "${NAMESPACE}" cp \
      "${archive}" "peer-join-tools:${remote_archive}"

    ensure_kind_package_installed "${remote_archive}" "${package_id}"

    docker_archive="/tmp/${name}-kind-caas.tgz"
    ensure_docker_host2_package_installed "${archive}" "${docker_archive}" "${package_id}"

    IFS="," read -r -a channels <<< "${channel_csv}"
    for channel in "${channels[@]}"; do
      committed="$(wait_for_kind_committed_definition "${channel}" "${name}")"
      current_sequence="$(jq -er '.sequence' <<< "${committed}")"
      approval="$(docker_peer_exec Host2MSP peer0-host2:7051 host2.example.com \
        peer lifecycle chaincode queryapproved --channelID "${channel}" \
        --name "${name}" --sequence "${current_sequence}" --output json)"
      host2_package_id="$(jq -er '.source.Type.LocalPackage.package_id' <<< "${approval}")"

      if [[ "${host2_package_id}" != "${package_id}" ]]; then
        target_sequence=$((current_sequence + 1))
        host1_approval="$(docker_peer_exec Host1MSP peer0-host1:7051 host1.example.com \
          peer lifecycle chaincode queryapproved --channelID "${channel}" \
          --name "${name}" --sequence "${current_sequence}" --output json)"
        host1_package_id="$(jq -er '.source.Type.LocalPackage.package_id' <<< "${host1_approval}")"

        docker_peer_exec Host1MSP peer0-host1:7051 host1.example.com \
          peer lifecycle chaincode approveformyorg \
          -o orderer:7050 \
          --ordererTLSHostnameOverride orderer \
          --tls --cafile /workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt \
          --channelID "${channel}" \
          --name "${name}" \
          --version 1.0 \
          --package-id "${host1_package_id}" \
          --sequence "${target_sequence}" \
          --signature-policy "OR('Host1MSP.member','Host2MSP.member')"

        docker_peer_exec Host2MSP peer0-host2:7051 host2.example.com \
          peer lifecycle chaincode approveformyorg \
          -o orderer:7050 \
          --ordererTLSHostnameOverride orderer \
          --tls --cafile /workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt \
          --channelID "${channel}" \
          --name "${name}" \
          --version 1.0 \
          --package-id "${package_id}" \
          --sequence "${target_sequence}" \
          --signature-policy "OR('Host1MSP.member','Host2MSP.member')"

        docker_peer_exec Host1MSP peer0-host1:7051 host1.example.com \
          peer lifecycle chaincode commit \
          -o orderer:7050 \
          --ordererTLSHostnameOverride orderer \
          --tls --cafile /workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt \
          --channelID "${channel}" \
          --name "${name}" \
          --version 1.0 \
          --sequence "${target_sequence}" \
          --signature-policy "OR('Host1MSP.member','Host2MSP.member')" \
          --peerAddresses peer0-host1:7051 \
          --tlsRootCertFiles /workspace/organizations/peerOrganizations/host1.example.com/peers/peer0.host1.example.com/tls/ca.crt \
          --peerAddresses peer0-host2:7051 \
          --tlsRootCertFiles /workspace/organizations/peerOrganizations/host2.example.com/peers/peer0.host2.example.com/tls/ca.crt

        committed="$(wait_for_kind_chaincode_commit "${channel}" "${name}" "${target_sequence}")"
      else
        target_sequence="${current_sequence}"
      fi

      approval="$(kind_peer_exec peer lifecycle chaincode queryapproved \
        --channelID "${channel}" --name "${name}" \
        --sequence "${target_sequence}" --output json)"
      jq -e --arg package_id "${package_id}" \
        '.source.Type.LocalPackage.package_id == $package_id' <<< "${approval}" >/dev/null
      jq -e --arg version '1.0' --arg msp "${KIND_PEER_MSP_ID}" \
        --argjson sequence "${target_sequence}" \
        '.version == $version and .sequence == $sequence and .approvals[$msp] == true' \
        <<< "${committed}" >/dev/null
    done

    KIND_PEER_CCAAS_NAMES="${KIND_PEER_CCAAS_NAMES}${KIND_PEER_CCAAS_NAMES:+,}${name}"
  done < "${KIND_CCAAS_MANIFEST}"
}

verify_kind_ccaas_readiness() {
  local spec name channel_csv channel output status
  local -a channels
  for spec in "${KIND_CCAAS_SPECS[@]}"; do
    IFS='|' read -r name channel_csv <<< "${spec}"
    IFS="," read -r -a channels <<< "${channel_csv}"
    for channel in "${channels[@]}"; do
      set +e
      output="$(kind_peer_exec peer chaincode query \
        --channelID "${channel}" --name "${name}" \
        --ctor '{"Args":["__readiness_probe__"]}' 2>&1)"
      status=$?
      set -e
      if [[ ${status} -ne 0 ]] \
        && [[ "${output}" != *'function that does not exist: __readiness_probe__'* ]]; then
        echo "El CCAAS ${name} no respondió en ${channel} a través del peer Kubernetes." >&2
        echo "${output}" >&2
        return 1
      fi
    done
  done
}
