#!/usr/bin/env bash
set -euo pipefail

# This smoke bridges the gap between:
# - consent rules anchored on the local Fabric-backed consent ledger
# - SMART token issuance based on those rules
# - actual endpoint access using the emitted access token
#
# Covered live paths:
# 1. individual consent -> SMART token -> individual Bundle/_search
# 2. medical-secretary consent -> SMART token -> individual Bundle/_search
# 3. unconsented medical secretary -> denied SMART token
# 4. research contract + provider consent -> SMART token -> public digitaltwin ResearchSubject/_search
# 5. allowed and denied research employees by role and by direct email

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/scripts/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:-acme-id}"
JURISDICTION="${JURISDICTION:-ES}"
SECTOR="${SECTOR:-health-care}"
CHANNEL_NAME="${CHANNEL_NAME:-health-care-local}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
FABRIC_QUERY_MODE="${FABRIC_QUERY_MODE:-docker}"
FABRIC_KUBE_CONTEXT="${FABRIC_KUBE_CONTEXT:-}"
FABRIC_KUBE_NAMESPACE="${FABRIC_KUBE_NAMESPACE:-}"
FABRIC_KUBE_POD="${FABRIC_KUBE_POD:-peer-join-tools}"
FABRIC_KUBE_PEER_ADDRESS="${FABRIC_KUBE_PEER_ADDRESS:-host-evidence-peer:7051}"
FABRIC_KUBE_TLS_ROOT="${FABRIC_KUBE_TLS_ROOT:-/tmp/peer-tls-root.pem}"
FABRIC_KUBE_SERVER_HOST_OVERRIDE="${FABRIC_KUBE_SERVER_HOST_OVERRIDE:-host-evidence-peer}"
HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"
HOST1_MSP_ID="${HOST1_MSP_ID:-Host1MSP}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
SUBJECT_ID="${SUBJECT_ID:-did:web:api.${TENANT_ID}.org:individual:subject-001}"
BOOTSTRAP_INDIVIDUAL_AND_DATA="${BOOTSTRAP_INDIVIDUAL_AND_DATA:-true}"
RUN_RESEARCH_SMART_SMOKE="${RUN_RESEARCH_SMART_SMOKE:-true}"

CONSENT_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Consent/_batch"
CONSENT_POLL_ENDPOINT="${CONSENT_ENDPOINT}-response"
SMART_TOKEN_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/identity/openid/smart/token"
SMART_TOKEN_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/identity/openid/smart/_batch-response"
INDIVIDUAL_BUNDLE_SEARCH_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Bundle/_search"
INDIVIDUAL_BUNDLE_SEARCH_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Bundle/_search-response"
DIGITAL_TWIN_SEARCH_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search"
DIGITAL_TWIN_SEARCH_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_batch-response"

HOST1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"
HOST1_PEER_TLS="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"

required_commands=(curl jq)
if [[ "${FABRIC_QUERY_MODE}" == "kubectl" ]]; then
  required_commands+=(kubectl)
  [[ -n "${FABRIC_KUBE_CONTEXT}" && -n "${FABRIC_KUBE_NAMESPACE}" ]] || {
    echo "ERROR: FABRIC_KUBE_CONTEXT and FABRIC_KUBE_NAMESPACE are required for kubectl queries" >&2
    exit 2
  }
else
  required_commands+=(docker)
fi
for cmd in "${required_commands[@]}"; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

query_rule_asset() {
  local rule_id="$1"
  if [[ "${FABRIC_QUERY_MODE}" == "kubectl" ]]; then
    kubectl --context "${FABRIC_KUBE_CONTEXT}" -n "${FABRIC_KUBE_NAMESPACE}" \
      exec "${FABRIC_KUBE_POD}" -- env \
      CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
      CORE_PEER_MSPCONFIGPATH=/tmp/admin-msp \
      CORE_PEER_ADDRESS="${FABRIC_KUBE_PEER_ADDRESS}" \
      CORE_PEER_TLS_ENABLED=true \
      CORE_PEER_TLS_ROOTCERT_FILE="${FABRIC_KUBE_TLS_ROOT}" \
      CORE_PEER_TLS_SERVERHOSTOVERRIDE="${FABRIC_KUBE_SERVER_HOST_OVERRIDE}" \
      peer chaincode query -C "${CHANNEL_NAME}" -n "${CHAINCODE_NAME}" \
      -c "{\"Args\":[\"ReadConsentAccess\",\"${rule_id}\"]}"
    return
  fi
  docker exec "${FABRIC_TOOLS_CONTAINER}" bash -lc \
    "CORE_PEER_LOCALMSPID=${HOST1_MSP_ID} \
CORE_PEER_MSPCONFIGPATH=${HOST1_ADMIN_MSP} \
CORE_PEER_ADDRESS=peer0-host1:7051 \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_TLS_ROOTCERT_FILE=${HOST1_PEER_TLS} \
peer chaincode query -C ${CHANNEL_NAME} -n ${CHAINCODE_NAME} -c '{\"Args\":[\"ReadConsentAccess\",\"${rule_id}\"]}'"
}

wait_for_rule_asset() {
  local rule_id="$1"
  local asset_json=''
  for _ in $(seq 1 15); do
    if asset_json="$(query_rule_asset "${rule_id}" 2>/dev/null)"; then
      printf '%s' "${asset_json}"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: timed out waiting for rule asset ${rule_id}" >&2
  return 1
}

post_json() {
  local url="$1"
  local bearer="$2"
  local payload="$3"
  curl -sS -X POST "${url}" \
    -H "Authorization: Bearer ${bearer}" \
    -H 'Content-Type: application/json' \
    --data-binary "${payload}"
}

poll_async_json() {
  local url="$1"
  local thid="$2"
  local attempts="${3:-40}"
  local sleep_s="${4:-1}"
  for _ in $(seq 1 "${attempts}"); do
    local body
    body="$(curl -sS -X POST "${url}" -H 'Content-Type: application/json' -d "{\"thid\":\"${thid}\"}")"
    local status
    status="$(jq -r '.status? // .body.status? // empty' <<<"${body}")"
    if [[ -n "${body}" && "${status}" != "202" && "${status}" != "PENDING" && "${status}" != "pending" ]]; then
      printf '%s' "${body}"
      return 0
    fi
    sleep "${sleep_s}"
  done
  echo "ERROR: timed out polling ${thid} on ${url}" >&2
  return 1
}

render_smart_payload() {
  local payload_name="$1"
  (
    export TENANT_ID SUBJECT_ID PROVIDER_ORGANIZATION_DID
    export SMART_TOKEN_AUDIENCE="${SMART_TOKEN_ENDPOINT}"
    render_demo_smart_access_payload "${payload_name}"
  )
}

resolve_provider_organization_did() {
  local did_url="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/.well-known/did.json"
  curl -fsS "${did_url}" | jq -er '.id | select(type == "string" and length > 0)'
}

submit_consent_batch_and_verify_asset() {
  local payload_name="$1"
  local rule_list_name="$2"

  local request_payload
  request_payload="$(render_smart_payload "${payload_name}")"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"
  local rule_ids_json
  rule_ids_json="$(render_smart_payload "${rule_list_name}")"
  local expected_rule_count
  expected_rule_count="$(jq 'length' <<<"${rule_ids_json}")"

  echo "[smart-access-smoke] POST consent batch ${payload_name}"
  post_json "${CONSENT_ENDPOINT}" "${AUTH_BEARER}" "${request_payload}" >/dev/null

  local poll_result
  poll_result="$(poll_async_json "${CONSENT_POLL_ENDPOINT}" "${thid}" 30 1)"
  local success_count
  success_count="$(jq '[.data[]?.response?.status == "201"] | map(select(. == true)) | length' <<<"${poll_result}")"
  if [[ "${success_count}" != "${expected_rule_count}" ]]; then
    echo "ERROR: expected ${expected_rule_count} successful consent responses for ${payload_name} but got ${success_count}" >&2
    echo "${poll_result}"
    exit 1
  fi

  for rule_id in $(jq -r '.[]' <<<"${rule_ids_json}"); do
    local asset_json
    asset_json="$(wait_for_rule_asset "${rule_id}")"
    jq -e --arg rule_id "${rule_id}" '.id == $rule_id and (.data | length) == 1 and .data[0].id == $rule_id' <<<"${asset_json}" >/dev/null
    echo "[smart-access-smoke] verified rule asset ${rule_id}"
  done
}

request_smart_token() {
  local payload_name="$1"
  local expect_access_token="$2"

  local request_payload
  request_payload="$(render_smart_payload "${payload_name}")"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"

  echo "[smart-access-smoke] POST smart token ${payload_name}" >&2
  post_json "${SMART_TOKEN_ENDPOINT}" "mock" "${request_payload}" >/dev/null

  local token_payload
  token_payload="$(poll_async_json "${SMART_TOKEN_POLL_ENDPOINT}" "${thid}" 40 1)"
  local access_token
  access_token="$(jq -r '.access_token // empty' <<<"${token_payload}")"

  if [[ "${expect_access_token}" == "true" ]]; then
    if [[ -z "${access_token}" ]]; then
      echo "ERROR: expected access_token for ${payload_name}" >&2
      echo "${token_payload}" >&2
      exit 1
    fi
  else
    if [[ -n "${access_token}" ]]; then
      echo "ERROR: expected denial for ${payload_name} but received access_token" >&2
      echo "${token_payload}" >&2
      exit 1
    fi
  fi

  printf '%s' "${token_payload}"
}

run_individual_bundle_search_with_token() {
  local access_token="$1"
  local payload_name="${2:-INDIVIDUAL_IPS_SEARCH_REQUEST}"
  local request_payload
  request_payload="$(render_smart_payload "${payload_name}")"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"

  echo "[smart-access-smoke] POST individual Bundle/_search"
  post_json "${INDIVIDUAL_BUNDLE_SEARCH_ENDPOINT}" "${access_token}" "${request_payload}" >/dev/null

  local search_payload
  search_payload="$(poll_async_json "${INDIVIDUAL_BUNDLE_SEARCH_POLL_ENDPOINT}" "${thid}" 40 1)"
  jq -e '.resourceType == "Bundle" and .data[0].response.status == "200"' <<<"${search_payload}" >/dev/null
  jq -e '.data[0].resource.resourceType == "Bundle" and .data[0].resource.type == "document"' <<<"${search_payload}" >/dev/null
  echo "[smart-access-smoke] verified individual Bundle/_search through SMART token"
}

run_digital_twin_search_with_token() {
  local access_token="$1"
  local request_payload
  request_payload="$(render_smart_payload DIGITAL_TWIN_RESEARCH_SUBJECT_SEARCH_REQUEST)"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"

  echo "[smart-access-smoke] POST digitaltwin ResearchSubject/_search"
  post_json "${DIGITAL_TWIN_SEARCH_ENDPOINT}" "${access_token}" "${request_payload}" >/dev/null

  local search_payload
  search_payload="$(poll_async_json "${DIGITAL_TWIN_SEARCH_POLL_ENDPOINT}" "${thid}" 40 1)"
  if ! jq -e '.resourceType == "Bundle" and .data[0].response.status == "200"' <<<"${search_payload}" >/dev/null; then
    echo "ERROR: digital-twin search did not return a successful batch response" >&2
    echo "${search_payload}" >&2
    return 1
  fi
  if ! jq -e '.data[0].type == "ResearchSubject-search-response-v1.0" and (.data[0].resource.total // 0) >= 1 and .data[0].resource.data[0].resourceType == "ResearchSubject" and (.data[0].resource.data[0].composition | type) == "object"' <<<"${search_payload}" >/dev/null; then
    echo "ERROR: digital-twin search returned no ResearchSubject with its canonical Composition index" >&2
    echo "${search_payload}" >&2
    return 1
  fi
  echo "[smart-access-smoke] verified digitaltwin ResearchSubject/_search through SMART token"
}

if [[ "${BOOTSTRAP_INDIVIDUAL_AND_DATA}" == "true" ]]; then
  echo "[smart-access-smoke] preparing canonical individual baseline and demo clinical data"
  BASE_URL="${BASE_URL}" \
  TENANT_ID="${TENANT_ID}" \
  JURISDICTION="${JURISDICTION}" \
  SECTOR="${SECTOR}" \
  AUTH_BEARER="${AUTH_BEARER}" \
  SUBJECT_ID="${SUBJECT_ID}" \
  bash "${ROOT_DIR}/scripts/demo-communication-medications-ips.sh"
fi

PROVIDER_ORGANIZATION_DID="${PROVIDER_ORGANIZATION_DID:-$(resolve_provider_organization_did)}"
echo "[smart-access-smoke] provider organization DID: ${PROVIDER_ORGANIZATION_DID}"

echo "[smart-access-smoke] verifying individual SMART access"
submit_consent_batch_and_verify_asset INDIVIDUAL_CONSENT_BATCH_REQUEST INDIVIDUAL_RULE_ID_LIST
individual_token_payload="$(request_smart_token INDIVIDUAL_SMART_TOKEN_REQUEST true)"
individual_access_token="$(jq -r '.access_token' <<<"${individual_token_payload}")"
run_individual_bundle_search_with_token "${individual_access_token}"

echo "[smart-access-smoke] verifying authorized medical-secretary access and negative control"
submit_consent_batch_and_verify_asset SECRETARY_CONSENT_BATCH_REQUEST SECRETARY_RULE_ID_LIST
secretary_token_payload="$(request_smart_token SECRETARY_SMART_TOKEN_REQUEST_ALLOW true)"
secretary_access_token="$(jq -r '.access_token' <<<"${secretary_token_payload}")"
run_individual_bundle_search_with_token "${secretary_access_token}" SECRETARY_IPS_SEARCH_REQUEST
request_smart_token SECRETARY_SMART_TOKEN_REQUEST_DENY false >/dev/null

if [[ "${RUN_RESEARCH_SMART_SMOKE}" != "true" ]]; then
  echo "[smart-access-smoke] cross-portal research flow skipped by release profile"
  exit 0
fi

echo "[smart-access-smoke] seeding research consent rules on ledger"
submit_consent_batch_and_verify_asset RESEARCH_CONSENT_BATCH_REQUEST_ROLE RESEARCH_RULE_ID_LIST_ROLE
submit_consent_batch_and_verify_asset RESEARCH_CONSENT_BATCH_REQUEST_EMAIL RESEARCH_RULE_ID_LIST_EMAIL

echo "[smart-access-smoke] verifying research SMART access allow/deny matrix"
research_role_allow_payload="$(request_smart_token RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW true)"
research_role_allow_token="$(jq -r '.access_token' <<<"${research_role_allow_payload}")"
run_digital_twin_search_with_token "${research_role_allow_token}"

request_smart_token RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY false >/dev/null

research_email_allow_payload="$(request_smart_token RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW true)"
research_email_allow_token="$(jq -r '.access_token' <<<"${research_email_allow_payload}")"
run_digital_twin_search_with_token "${research_email_allow_token}"

request_smart_token RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY false >/dev/null

echo "[smart-access-smoke] success"
jq -n \
  --arg subject "${SUBJECT_ID}" \
  --arg channel "${CHANNEL_NAME}" \
  --arg chaincode "${CHAINCODE_NAME}" \
  '{
    subject: $subject,
    channel: $channel,
    chaincode: $chaincode,
    verifiedFlows: [
      "individual-consent-smart-bundle-search",
      "medical-secretary-consent-smart-bundle-search-allow",
      "medical-secretary-without-consent-smart-token-deny",
      "research-contract-consent-smart-digitaltwin-search-role-allow",
      "research-contract-consent-smart-digitaltwin-search-role-deny",
      "research-contract-consent-smart-digitaltwin-search-email-allow",
      "research-contract-consent-smart-digitaltwin-search-email-deny"
    ]
  }'
