#!/usr/bin/env bash
set -euo pipefail

GW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${GW_ROOT}/.." && pwd)"
DATASPACE_CA_ROOT="${WORKSPACE_ROOT}/dataspace-ca-ts"
DATASPACE_ICA_ROOT="${WORKSPACE_ROOT}/dataspace-ica-ts"
FABRIC_ROOT="${WORKSPACE_ROOT}/fabric-multicloud"
FABRIC_DEVNET_ROOT="${FABRIC_ROOT}/devnet/fabric-v3"

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
  leaked_secret_pattern='(adminpw|peer0org1pw|peer0org2pw|ordereradminpw|orderer0pw)'
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
  [[ -d "${repository}/.git" ]] || {
    echo "Missing sibling repository: ${repository}" >&2
    exit 2
  }
}

record_environment() {
  printf 'generated_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'image=%s\n' "${IMAGE_NAME}"
  printf 'node=%s\n' "$(node --version)"
  printf 'docker=%s\n' "$(docker --version)"
  for repository in "${GW_ROOT}" "${DATASPACE_CA_ROOT}" "${DATASPACE_ICA_ROOT}" "${FABRIC_ROOT}"; do
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
  npm run check:skills
}

test_fabric_governance_contract() {
  cd "${FABRIC_ROOT}"
  node --test scripts/governance/tests/*.test.mjs scripts/onboarding/tests/*.test.mjs
  bash ./scripts/tests/local-host-msp-names.test.sh
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
  docker rm -f consentaccess-sc >/dev/null 2>&1 || true
  local volume
  for volume in \
    gdc-fabric-v3-devnet_orderer-data \
    gdc-fabric-v3-devnet_peer0-org1-data \
    gdc-fabric-v3-devnet_peer0-org2-data; do
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
  CA_HOST=root-ca \
  CA_TLS_CERT=/workspace/crypto/ca/root/ca-cert.pem \
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
  host1_channels="$(peer_channels Host1MSP peer0-org1:7051 org1.example.com)"
  host2_channels="$(peer_channels Host2MSP peer0-org2:7051 org2.example.com)"
  printf '%s\n' "${host1_channels}"
  printf '%s\n' "${host2_channels}"
  for channel in identity-local health-care-local; do
    grep -qx "${channel}" <<< "${host1_channels}"
    grep -qx "${channel}" <<< "${host2_channels}"
  done
  grep -Fq 'HLF_MSP_ID_HOST1=Host1MSP' .env.fabric-devnet
  grep -Fq 'HLF_MSP_ID_HOST2=Host2MSP' .env.fabric-devnet
  docker inspect gdc-peer0-org1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -qx 'CORE_PEER_LOCALMSPID=Host1MSP'
  docker inspect gdc-peer0-org2 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -qx 'CORE_PEER_LOCALMSPID=Host2MSP'
}

prove_runtime_data_plane() {
  export OPEN_SOURCE_LOCAL_KEK_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
  cd "${GW_ROOT}"
  LOCAL_FABRIC_CA_SOURCE=dataspace-ca \
  DATASPACE_CA_ROOT_DIR="${CA_ROOT_DIR}" \
  DATASPACE_CA_ISSUER_DIR="${CA_ISSUER_DIR}" \
  KEEP_CONTAINER=false \
  IMAGE_NAME="${IMAGE_NAME}" \
    npm run docker:smoke:open-source-local-network
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
const body = `# Local production-readiness evidence\n\n` +
  `Image: \`${imageName}\`\n\n` +
  `## Verified gates\n\n${gates}\n\n` +
  `## Fabric and tenant boundary\n\n` +
  `\`Host1MSP\` and \`Host2MSP\` are Fabric members. VAT-addressed tenant Organizations are application data hosted by a GW and are not Fabric MSPs. Both local host peers join \`identity-local\` and \`health-care-local\`; \`onehealth-research\` is the GW sector, not a channel. In production, EU Organizations and employees route to \`identity-eu\`, while human individuals route to \`identity-global\`. Animal and veterinary domains are outside this evidence scope.\n\n` +
  `## Human employee access proof\n\n` +
  `The employee onboarding/DCR contract creates an organization-scoped medical secretary. The live PostgreSQL/IPFS/Fabric smoke creates a person's health data, grants that secretary an explicit IPS consent, proves the SMART-authorized read and denies a second secretary without consent. The selected production profile routes both entity/employee and individual services for the same VAT tenant to one host while keeping identity-eu and identity-global ledger bindings separate.\n\n` +
  `## Production limitation\n\n` +
  `This package proves the governed admission contract and a real two-host bootstrap topology. It does not claim that Host2MSP was dynamically added to an already-running Host1-only channel: the operator-owned Fabric mutation driver still requires a live E2E before production admission can be called automatic.\n`;
writeFileSync(join(evidenceDir, 'SUMMARY.md'), body, { mode: 0o644 });
NODE
}

for repository in "${GW_ROOT}" "${DATASPACE_CA_ROOT}" "${DATASPACE_ICA_ROOT}" "${FABRIC_ROOT}"; do
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
run_gate 50-evidence-summary write_summary
run_gate 60-public-secret-scan assert_public_evidence_contains_no_demo_secrets

node "${GW_ROOT}/scripts/build-open-source-evidence-manifest.mjs" \
  --evidence-dir "${EVIDENCE_DIR}" \
  --image "${IMAGE_NAME}" >/dev/null

echo "Open-source production-readiness evidence: ${EVIDENCE_DIR}"
