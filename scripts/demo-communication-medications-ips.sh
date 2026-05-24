#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:-${E2E_TENANT_ID:-acme}}"
JURISDICTION="${JURISDICTION:-${E2E_JURISDICTION:-ES}}"
SECTOR="${SECTOR:-${E2E_SECTOR:-health-care}}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
SUBJECT_ID="${SUBJECT_ID:-did:web:api.${TENANT_ID}.org:individual:subject-001}"
MODE="${MODE:-didcomm}" # didcomm | legacy-fhir

if [[ "${1:-}" == "--mode" ]]; then
  MODE="${2:-$MODE}"
  shift 2 || true
fi

if [[ "$MODE" != "didcomm" && "$MODE" != "legacy-fhir" ]]; then
  echo "ERROR: invalid MODE='$MODE' (allowed: didcomm, legacy-fhir)"
  exit 2
fi

THID_COMM="comm-medications-$(date +%s)"
THID_MED_SEARCH="medications-search-$(date +%s)"
THID_IPS_SEARCH="ips-search-$(date +%s)"

COMM_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Communication/_batch"
COMM_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Communication/_batch-response"
MED_SEARCH_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.api/MedicationStatement/_search"
MED_SEARCH_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.api/MedicationStatement/_batch-response"
IPS_SEARCH_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Bundle/_search"
IPS_SEARCH_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Bundle/_search-response"

poll_async() {
  local url="$1"
  local thid="$2"
  local attempts="${3:-40}"
  local sleep_s="${4:-1}"
  for _ in $(seq 1 "$attempts"); do
    local body
    body="$(curl -sS -X POST "$url" -H "Content-Type: application/json" -d "{\"thid\":\"$thid\"}")"
    local status
    status="$(echo "$body" | jq -r '.status // empty')"
    if [[ "$status" != "202" ]]; then
      echo "$body"
      return 0
    fi
    sleep "$sleep_s"
  done
  echo "{\"status\":500,\"issues\":{\"issue\":[{\"diagnostics\":\"Timeout polling thid=$thid\"}]}}"
  return 1
}

echo "[1/4] Building FHIR document bundle with Composition + MedicationStatement..."
DOC_BUNDLE_JSON="$(cat <<JSON
{
  "resourceType": "Bundle",
  "type": "document",
  "entry": [
    {
      "resource": {
        "resourceType": "Composition",
        "id": "ips-composition-001",
        "status": "final",
        "type": {
          "coding": [{ "system": "http://loinc.org", "code": "60591-5", "display": "Patient summary Document" }]
        },
        "subject": { "reference": "$SUBJECT_ID" },
        "date": "2026-05-22T10:00:00Z",
        "title": "IPS Medication Summary",
        "section": [
          {
            "code": { "coding": [{ "system": "http://loinc.org", "code": "10160-0", "display": "History of Medication Use" }] },
            "entry": [{ "reference": "urn:uuid:medication-001" }]
          }
        ]
      }
    },
    {
      "resource": {
        "resourceType": "MedicationStatement",
        "id": "medication-001",
        "status": "active",
        "subject": { "reference": "$SUBJECT_ID" },
        "effectiveDateTime": "2026-05-22T10:00:00Z",
        "medicationCodeableConcept": {
          "text": "Paracetamol 500mg"
        },
        "note": [{ "text": "Tomar una pastilla cada 8 horas" }],
        "identifier": [{ "system": "urn:ietf:rfc:3986", "value": "urn:uuid:medication-001" }]
      }
    }
  ]
}
JSON
)"

DOC_BUNDLE_B64="$(
  DOC_BUNDLE_JSON="$DOC_BUNDLE_JSON" node -e "process.stdout.write(Buffer.from(process.env.DOC_BUNDLE_JSON || '', 'utf8').toString('base64'))"
)"

DOCREF_JSON="$(cat <<JSON
{
  "resourceType": "DocumentReference",
  "id": "ips-document-reference-001",
  "subject": { "reference": "$SUBJECT_ID" },
  "date": "2026-05-22T10:00:00Z",
  "description": "IPS Medication Summary",
  "identifier": [{ "system": "urn:ietf:rfc:3986", "value": "urn:uuid:ips-document-reference-001" }],
  "content": [
    {
      "attachment": {
        "contentType": "application/fhir+json",
        "title": "ips-medications.json",
        "data": "$DOC_BUNDLE_B64"
      }
    }
  ]
}
JSON
)"

DOCREF_B64="$(
  DOCREF_JSON="$DOCREF_JSON" node -e "process.stdout.write(Buffer.from(process.env.DOCREF_JSON || '', 'utf8').toString('base64'))"
)"

echo "[2/4] Sending Communication/_batch with embedded DocumentReference (mode=$MODE)..."
DIDCOMM_COMM_REQ="$(cat <<JSON
{
  "thid": "$THID_COMM",
  "body": {
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [
      {
        "request": { "method": "POST", "url": "individual/org.hl7.fhir.r4/Communication" },
        "meta": {
          "claims": {
            "@context": "org.hl7.fhir.r4",
            "Communication.subject": "$SUBJECT_ID",
            "Communication.sent": "2026-05-22T10:00:00Z",
            "Composition.section": "LOINC|10160-0"
          }
        },
        "resource": {
          "resourceType": "Communication",
          "status": "completed",
          "subject": { "reference": "$SUBJECT_ID" },
          "sent": "2026-05-22T10:00:00Z",
          "payload": [
            {
              "contentAttachment": {
                "contentType": "application/fhir+json",
                "title": "ips-document-reference.json",
                "data": "$DOCREF_B64"
              }
            }
          ]
        }
      }
    ]
  }
}
JSON
)"

LEGACY_FHIR_COMM_REQ="$(cat <<JSON
{
  "thid": "$THID_COMM",
  "resourceType": "Bundle",
  "type": "batch",
  "entry": [
    {
      "request": { "method": "POST", "url": "individual/org.hl7.fhir.r4/Communication" },
      "meta": {
        "claims": {
          "@context": "org.hl7.fhir.r4",
          "Communication.subject": "$SUBJECT_ID",
          "Communication.sent": "2026-05-22T10:00:00Z",
          "Composition.section": "LOINC|10160-0"
        }
      },
      "resource": {
        "resourceType": "Communication",
        "status": "completed",
        "subject": { "reference": "$SUBJECT_ID" },
        "sent": "2026-05-22T10:00:00Z",
        "payload": [
          {
            "contentAttachment": {
              "contentType": "application/fhir+json",
              "title": "ips-document-reference.json",
              "data": "$DOCREF_B64"
            }
          }
        ]
      }
    }
  ]
}
JSON
)"

COMM_CONTENT_TYPE="application/json"
COMM_REQ="$DIDCOMM_COMM_REQ"
if [[ "$MODE" == "legacy-fhir" ]]; then
  COMM_CONTENT_TYPE="application/fhir+json"
  COMM_REQ="$LEGACY_FHIR_COMM_REQ"
fi

COMM_SUBMIT="$(curl -sS -X POST "$COMM_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: $COMM_CONTENT_TYPE" \
  -d "$COMM_REQ")"
echo "$COMM_SUBMIT" | jq '.'

echo "[2/4] Polling Communication/_batch-response..."
COMM_DONE="$(poll_async "$COMM_POLL_URL" "$THID_COMM")"
echo "$COMM_DONE" | jq '.'

echo "[3/4] Searching MedicationStatement/_search..."
MED_SEARCH_REQ="$(cat <<JSON
{
  "thid": "$THID_MED_SEARCH",
  "body": {
    "data": [
      {
        "type": "MedicationStatement-search-request-v1.0",
        "meta": {
          "claims": {
            "@context": "org.hl7.fhir.api",
            "MedicationStatement.subject": "$SUBJECT_ID"
          }
        }
      }
    ]
  }
}
JSON
)"
MED_SUBMIT="$(curl -sS -X POST "$MED_SEARCH_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$MED_SEARCH_REQ")"
echo "$MED_SUBMIT" | jq '.'

echo "[3/4] Polling MedicationStatement search..."
MED_DONE="$(poll_async "$MED_SEARCH_POLL_URL" "$THID_MED_SEARCH")"
echo "$MED_DONE" | jq '.'

echo "[4/4] Searching IPS Bundle/_search by subject + medication section..."
IPS_SEARCH_REQ="$(cat <<JSON
{
  "thid": "$THID_IPS_SEARCH",
  "body": {
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [
      {
        "request": {
          "method": "GET",
          "url": "Bundle?type=document&composition.subject=$(printf '%s' "$SUBJECT_ID" | jq -sRr @uri)&composition.section=LOINC%7C10160-0"
        }
      }
    ]
  }
}
JSON
)"
IPS_SUBMIT="$(curl -sS -X POST "$IPS_SEARCH_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$IPS_SEARCH_REQ")"
echo "$IPS_SUBMIT" | jq '.'

echo "[4/4] Polling IPS Bundle search..."
IPS_DONE="$(poll_async "$IPS_SEARCH_POLL_URL" "$THID_IPS_SEARCH")"
echo "$IPS_DONE" | jq '.'
