#!/usr/bin/env bash
set -euo pipefail

GW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATASPACE_CA_ROOT="${DATASPACE_CA_ROOT:-${GW_ROOT}/../dataspace-ca-ts}"
DATASPACE_ICA_ROOT="${DATASPACE_ICA_ROOT:-${GW_ROOT}/../dataspace-ica-ts}"
FABRIC_DEVNET_ROOT="${GW_ROOT}/infra/fabric/local-network"

RUN_ID="${EVIDENCE_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
EVIDENCE_DIR="${EVIDENCE_DIR:-${GW_ROOT}/artifacts/open-source-production-readiness/${RUN_ID}}"
IMAGE_NAME="${IMAGE_NAME:-gw-core:$(node -p "require('${GW_ROOT}/package.json').version")-$(git -C "${GW_ROOT}" rev-parse --short HEAD)}"
CA_WORKSPACE="$(mktemp -d)"
CA_ROOT_DIR="${CA_WORKSPACE}/root"
CA_ISSUER_DIR="${CA_WORKSPACE}/issuer"
CA_PUBLIC_DIR="${CA_WORKSPACE}/public"

mkdir -p "${EVIDENCE_DIR}/gates" "${EVIDENCE_DIR}/logs"

cleanup() {
  unset EVIDENCE_CA_ROOT_PASSPHRASE EVIDENCE_CA_ISSUER_PASSPHRASE OPEN_SOURCE_LOCAL_KEK_SECRET
  rm -rf "${CA_WORKSPACE}"
}

finalize() {
  if docker image inspect "${IMAGE_NAME}" >/dev/null 2>&1; then
    node "${GW_ROOT}/scripts/build-open-source-evidence-manifest.mjs" \
      --evidence-dir "${EVIDENCE_DIR}" \
      --image "${IMAGE_NAME}" >/dev/null || true
  fi
}

trap 'finalize; cleanup' EXIT

run_gate() {
  local gate_id="$1"
  shift
  local log_file="${EVIDENCE_DIR}/logs/${gate_id}.log"
  echo "[evidence] ${gate_id}"
  set +e
  "$@" 2>&1 \
    | sed -E \
      -e 's/^Password: .+$/Password: [REDACTED]/' \
      -e 's#(https?://[^:/[:space:]]+):[^@/[:space:]]+@#\1:[REDACTED]@#g' \
    | tee "${log_file}"
  local status="${PIPESTATUS[0]}"
  set -e
  if [[ ${status} -ne 0 ]]; then
    printf 'FAIL\n' > "${EVIDENCE_DIR}/gates/${gate_id}.status"
    echo "[evidence] FAIL ${gate_id}; see ${log_file}" >&2
    return "${status}"
  fi
  printf 'PASS\n' > "${EVIDENCE_DIR}/gates/${gate_id}.status"
  echo "[evidence] PASS ${gate_id}"
}

assert_public_evidence_contains_no_demo_secrets() {
  local leaked_secret_pattern
  leaked_secret_pattern='(adminpw|peer0host1pw|peer0host2pw|ordereradminpw|orderer0pw)'
  if rg -n "${leaked_secret_pattern}" "${EVIDENCE_DIR}"; then
    echo 'Public evidence contains a disposable devnet enrollment secret.' >&2
    return 1
  fi
  if rg -n --pcre2 'Password: (?!\[REDACTED\])' "${EVIDENCE_DIR}"; then
    echo 'Public evidence contains an unredacted password line.' >&2
    return 1
  fi
}

require_repository() {
  local repository="$1"
  git -C "${repository}" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "Missing sibling repository: ${repository}" >&2
    exit 2
  }
}

record_environment() {
  printf 'generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'image=%s\n' "${IMAGE_NAME}"
  printf 'node=%s\n' "$(node --version)"
  printf 'docker=%s\n' "$(docker --version)"
  for repository in "${GW_ROOT}" "${DATASPACE_CA_ROOT}" "${DATASPACE_ICA_ROOT}"; do
    printf '%s_commit=%s\n' "$(basename "${repository}")" "$(git -C "${repository}" rev-parse HEAD)"
    if git -C "${repository}" diff --quiet && git -C "${repository}" diff --cached --quiet; then
      printf '%s_tracked_tree=clean\n' "$(basename "${repository}")"
    else
      printf '%s_tracked_tree=dirty\n' "$(basename "${repository}")"
    fi
  done
  docker image inspect "${IMAGE_NAME}" --format 'image_id={{.Id}} platform={{.Os}}/{{.Architecture}}'
}

test_dataspace_ca() {
  cd "${DATASPACE_CA_ROOT}"
  npm test
  npm run check
}

publish_disposable_dataspace_ca() {
  export EVIDENCE_CA_ROOT_PASSPHRASE="$(openssl rand -base64 36 | tr -d '\n')"
  export EVIDENCE_CA_ISSUER_PASSPHRASE="$(openssl rand -base64 36 | tr -d '\n')"
  cd "${DATASPACE_CA_ROOT}"
  node ./bin/dataspace-ca-cli.js root:bootstrap \
    --domain ca.local.example.test \
    --profile staging \
    --passphrase-env EVIDENCE_CA_ROOT_PASSPHRASE \
    --scrypt 10:1:1:48 \
    --out-dir "${CA_ROOT_DIR}"
  node ./bin/dataspace-ca-cli.js issuer:bootstrap \
    --domain ca.local.example.test \
    --root-dir "${CA_ROOT_DIR}" \
    --profile staging \
    --passphrase-env EVIDENCE_CA_ISSUER_PASSPHRASE \
    --scrypt 10:1:1:48 \
    --jurisdiction EU \
    --sector onehealth-research \
    --out-dir "${CA_ISSUER_DIR}"
  node ./bin/dataspace-ca-cli.js publish:static \
    --domain ca.local.example.test \
    --root-dir "${CA_ROOT_DIR}" \
    --issuer-dir "${CA_ISSUER_DIR}" \
    --profile staging \
    --out-dir "${CA_PUBLIC_DIR}"

  cp -R "${CA_PUBLIC_DIR}" "${EVIDENCE_DIR}/dataspace-ca-public"
  openssl verify -CAfile "${CA_ROOT_DIR}/root-cert.pem" "${CA_ISSUER_DIR}/issuer-cert.pem"
  openssl x509 -in "${CA_ROOT_DIR}/root-cert.pem" -noout -subject -issuer -fingerprint -sha256
  openssl x509 -in "${CA_ISSUER_DIR}/issuer-cert.pem" -noout -subject -issuer -fingerprint -sha256
  if find "${EVIDENCE_DIR}/dataspace-ca-public" -type f \( -iname '*key*' -o -iname '*private*' \) | grep -q .; then
    echo 'Private-looking CA material entered the public evidence directory.' >&2
    return 1
  fi
}

test_dataspace_ica_host_activation() {
  cd "${DATASPACE_ICA_ROOT}"
  node --test \
    ./test/api.host-service-form-pdf-fields.test.ts \
    ./test/api.vc-bundle.test.ts
  npm run test:host-preauthorization
  npm run check:skills
}

test_fabric_governance_contract() {
  cd "${GW_ROOT}"
  bash ./scripts/tests/local-fabric-host-names.test.sh
  node --test scripts/governance/tests/*.test.mjs scripts/onboarding/tests/*.test.mjs
  bash ./scripts/check-identity-chaincode-parity.sh
}

test_human_channel_taxonomy() {
  cd "${GW_ROOT}"
  npm test -- --runInBand \
    src/__tests__/unit/utils/ledger.test.ts \
    src/__tests__/unit/blockchain/ledger-channel-name.test.ts
}

test_employee_onboarding_contract() {
  cd "${GW_ROOT}"
  npm test -- --runInBand src/__tests__/integration/byok-dcr.test.ts
  grep -Fq 'SECRETARY_SMART_TOKEN_REQUEST_ALLOW' scripts/smoke-smart-access-local-network.sh
  grep -Fq 'SECRETARY_SMART_TOKEN_REQUEST_DENY' scripts/smoke-smart-access-local-network.sh
}

reset_fabric_devnet() {
  cd "${FABRIC_DEVNET_ROOT}"
  docker compose down -v --remove-orphans || true
  local container
  for container in gdc-orderer gdc-peer0-host1 gdc-peer0-host2 gdc-fabric-tools gdc-fabric-ca-client gdc-ica gdc-root-ca consentaccess-sc; do
    docker rm -f "${container}" >/dev/null 2>&1 || true
  done
  for attempt in $(seq 1 30); do
    local remaining=false
    for container in gdc-orderer gdc-peer0-host1 gdc-peer0-host2 gdc-fabric-tools gdc-fabric-ca-client gdc-ica gdc-root-ca; do
      docker container inspect "${container}" >/dev/null 2>&1 && remaining=true
    done
    [[ "${remaining}" == "false" ]] && break
    [[ "${attempt}" != "30" ]] || {
      echo 'Fabric devnet containers were not removed before reset.' >&2
      return 1
    }
    sleep 1
  done
  local volume
  for volume in \
    gdc-fabric-v3-devnet_orderer-data \
    gdc-fabric-v3-devnet_peer0-host1-data \
    gdc-fabric-v3-devnet_peer0-host2-data; do
    if docker volume inspect "${volume}" >/dev/null 2>&1; then
      docker volume rm "${volume}"
    fi
  done
}

peer_channels() {
  local msp_id="$1"
  local peer_address="$2"
  local domain="$3"
  docker exec \
    -e CORE_PEER_LOCALMSPID="${msp_id}" \
    -e CORE_PEER_MSPCONFIGPATH="/workspace/organizations/peerOrganizations/${domain}/users/Admin@${domain}/msp" \
    -e CORE_PEER_ADDRESS="${peer_address}" \
    -e CORE_PEER_TLS_ENABLED=true \
    -e CORE_PEER_TLS_ROOTCERT_FILE="/workspace/organizations/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt" \
    gdc-fabric-tools peer channel list
}

prove_multi_host_topology() {
  reset_fabric_devnet
  cd "${FABRIC_DEVNET_ROOT}"
  bash ./scripts/00-copy-dataspace-ca.sh "${CA_ROOT_DIR}" "${CA_ISSUER_DIR}"
  bash ./scripts/01-up-cas.sh
  SINGLE_HOST=false \
  HLF_DATA_CHANNEL_NAME=health-care-local \
  HLF_IDENTITY_CHANNEL_NAME=identity-local \
  HLF_BOOTSTRAP_CHANNELS=identity-local,health-care-local \
    bash ./scripts/02-bootstrap-network.sh
  SINGLE_HOST=false \
  HLF_DATA_CHANNEL_NAME=health-care-local \
  HLF_IDENTITY_CHANNEL_NAME=identity-local \
  HLF_BOOTSTRAP_CHANNELS=identity-local,health-care-local \
    bash ./scripts/04-generate-backend-env.sh

  local host1_channels host2_channels
  host1_channels="$(peer_channels Host1MSP peer0-host1:7051 host1.example.com)"
  host2_channels="$(peer_channels Host2MSP peer0-host2:7051 host2.example.com)"
  printf '%s\n' "${host1_channels}"
  printf '%s\n' "${host2_channels}"
  for channel in identity-local health-care-local; do
    grep -qx "${channel}" <<< "${host1_channels}"
    grep -qx "${channel}" <<< "${host2_channels}"
  done
  grep -Fq 'HLF_MSP_ID_HOST1=Host1MSP' .env.fabric-devnet
  grep -Fq 'HLF_MSP_ID_HOST2=Host2MSP' .env.fabric-devnet
  docker inspect gdc-peer0-host1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -qx 'CORE_PEER_LOCALMSPID=Host1MSP'
  docker inspect gdc-peer0-host2 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -qx 'CORE_PEER_LOCALMSPID=Host2MSP'

  local root_certificate="${FABRIC_DEVNET_ROOT}/crypto/ca/root/ca-cert.pem"
  local fabric_ica_certificate="${FABRIC_DEVNET_ROOT}/crypto/ca/ica/ca-cert.pem"
  local fabric_ica_subject
  fabric_ica_subject="$(openssl x509 -in "${fabric_ica_certificate}" -noout -subject -nameopt RFC2253 | sed 's/^subject=//')"
  local host_domain leaf certificate_issuer
  for host_domain in host1.example.com host2.example.com; do
    for leaf in \
      "${FABRIC_DEVNET_ROOT}/organizations/peerOrganizations/${host_domain}/peers/peer0.${host_domain}/msp/signcerts/cert.pem" \
      "${FABRIC_DEVNET_ROOT}/organizations/peerOrganizations/${host_domain}/peers/peer0.${host_domain}/tls/signcerts/cert.pem"; do
      openssl verify -CAfile "${root_certificate}" -untrusted "${fabric_ica_certificate}" "${leaf}"
      certificate_issuer="$(openssl x509 -in "${leaf}" -noout -issuer -nameopt RFC2253 | sed 's/^issuer=//')"
      [[ "${certificate_issuer}" == "${fabric_ica_subject}" ]] || {
        echo "Fabric identity was not issued by the Fabric ICA: ${leaf}" >&2
        return 1
      }
    done
  done
}

prove_runtime_data_plane() {
  export OPEN_SOURCE_LOCAL_KEK_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
  local local_demo_env="${CA_WORKSPACE}/gw-local-demo.env"
  cp "${GW_ROOT}/env.local-demo.example" "${local_demo_env}"
  cd "${GW_ROOT}"
  LOCAL_FABRIC_CA_SOURCE=dataspace-ca \
  LOCAL_DEMO_ENV_FILE="${local_demo_env}" \
  DATASPACE_CA_ROOT_DIR="${CA_ROOT_DIR}" \
  DATASPACE_CA_ISSUER_DIR="${CA_ISSUER_DIR}" \
  KEEP_CONTAINER=false \
  IMAGE_NAME="${IMAGE_NAME}" \
    npm run docker:smoke:open-source-local-network
}

prove_helm_runtime_data_plane() {
  cd "${GW_ROOT}"
  IMAGE_NAME="${IMAGE_NAME}" \
  FABRIC_ENV_FILE="${GW_ROOT}/.env.local-fabric" \
  KEEP_HELM_EVIDENCE_CLUSTER=false \
    npm run helm:smoke:local-network
}

write_summary() {
  node --input-type=module - "${EVIDENCE_DIR}" "${IMAGE_NAME}" <<'NODE'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [evidenceDir, imageName] = process.argv.slice(2);
const gates = readdirSync(join(evidenceDir, 'gates'))
  .filter((name) => name.endsWith('.status'))
  .sort()
  .map((name) => `- ${name.replace('.status', '')}: ${readFileSync(join(evidenceDir, 'gates', name), 'utf8').trim()}`)
  .join('\n');
const body = `# Evidencia local de preparación para producción\n\n` +
  `Imagen: \`${imageName}\`\n\n` +
  `## Comprobaciones verificadas\n\n${gates}\n\n` +
  `## Separación entre hosts y tenants\n\n` +
  `\`Host1MSP\` y \`Host2MSP\` son miembros de Fabric. Las organizaciones tenant identificadas por VAT son datos de aplicación alojados por un GW y no son MSP de Fabric. Los dos peers locales participan en \`identity-local\` y \`health-care-local\`; \`onehealth-research\` es un sector del GW, no un canal. En el perfil europeo, organizaciones y empleados usan \`identity-eu\`, mientras que las personas usan \`identity-global\`.\n\n` +
  `## Prueba de acceso de un empleado\n\n` +
  `El contrato de alta crea un secretario médico limitado a su organización. La prueba real con PostgreSQL, IPFS y Fabric crea datos de una persona, concede un consentimiento IPS explícito al secretario, acredita la lectura autorizada mediante SMART y deniega a otro secretario sin consentimiento. El perfil mantiene separadas las vinculaciones de identidad de organización y de persona.\n\n` +
  `## Prueba Kubernetes mediante Helm\n\n` +
  `El gate \`45-helm-kubernetes-runtime\` instala peer Host1MSP, CouchDB, GW, PostgreSQL e IPFS en un clúster kind mediante el chart público. Enrola MSP/TLS exclusivos, une el peer a \`identity-local\` y \`health-care-local\`, repite los flujos funcionales y demuestra persistencia tras reiniciar GW y peer. El GW usa el peer Docker con los chaincodes ya instalados; quedan pendientes el lifecycle CCAAS sobre el peer kind y el E2E apuntando a ese peer.\n\n` +
  `## Límite demostrado\n\n` +
  `El paquete demuestra el contrato de admisión gobernada y el arranque reproducible de una topología con dos hosts. No declara todavía como automática la incorporación dinámica de \`Host2MSP\` a un canal que ya estuviera funcionando únicamente con \`Host1MSP\`; esa mutación del consorcio requiere su propia prueba E2E viva.\n`;
writeFileSync(join(evidenceDir, 'SUMMARY.md'), body, { mode: 0o644 });
NODE
}

for repository in "${GW_ROOT}" "${DATASPACE_CA_ROOT}" "${DATASPACE_ICA_ROOT}"; do
  require_repository "${repository}"
done
docker image inspect "${IMAGE_NAME}" >/dev/null

run_gate 00-environment record_environment
run_gate 10-dataspace-ca-tests test_dataspace_ca
run_gate 11-dataspace-ca-publication publish_disposable_dataspace_ca
run_gate 20-dataspace-ica-host-activation test_dataspace_ica_host_activation
run_gate 30-fabric-governance-contract test_fabric_governance_contract
run_gate 31-fabric-multi-host-topology prove_multi_host_topology
run_gate 35-human-channel-taxonomy test_human_channel_taxonomy
run_gate 36-employee-onboarding-contract test_employee_onboarding_contract
run_gate 40-gw-postgres-ipfs-fabric-runtime prove_runtime_data_plane
run_gate 45-helm-kubernetes-runtime prove_helm_runtime_data_plane
run_gate 50-evidence-summary write_summary
run_gate 60-public-secret-scan assert_public_evidence_contains_no_demo_secrets

node "${GW_ROOT}/scripts/build-open-source-evidence-manifest.mjs" \
  --evidence-dir "${EVIDENCE_DIR}" \
  --image "${IMAGE_NAME}" >/dev/null

echo "Open-source production-readiness evidence: ${EVIDENCE_DIR}"
