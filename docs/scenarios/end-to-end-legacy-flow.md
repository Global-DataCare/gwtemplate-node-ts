# Full End-to-End cURL Guide (Legacy Mode)

This document provides a complete, step-by-step guide for developers and integrators to test the entire legacy workflow using `cURL`. The commands are designed to be copied and pasted directly into a terminal.

## Architecture Summary

This flow demonstrates a sophisticated, attribute-based access control (ABAC) architecture:
1.  **Predetermined Consents**: The patient defines general access rules using ODRL policies. These are identified by the patient's `did:web`. These rules control access based on **indexed attributes** (e.g., `org.hl7.fhir.api.Appointment.serviceType`).
2.  **Channel Consents**: A professional's application requests a temporary, specific "channel" for an interaction via an OAuth2 `launch` flow. This creates a new `Consent` resource with a unique `urn:uuid`.
3.  **`launch/list`**: The `launch` request uses the `launch/list` scope to ask the server to create a FHIR `List` resource. The `id` of this `List` (a `urn:uuid`) becomes the unique **Channel ID**.
4.  **`fhirContext`**: The server returns this Channel ID to the application in the `fhirContext` of the OAuth2 token response, linking the access token to the specific interaction.
5.  **`partOf`**: The application then uses this Channel ID in the `partOf.reference` field of any subsequent resources (like `Communication`) to link them to the authorized channel.
6.  **Enforcement**: The `AuthorizationManager` enforces access by ensuring all actions are linked to a valid channel and that any data queries or resource creations adhere to the granular ODRL policies defined in the patient's predetermined consent.

## Prerequisites

1.  **Run the Server**: `npm run dev`
2.  **Tokens**: Ensure mock tokens like `{RECEPTIONIST1_ID_TOKEN}` are in your `.env` file.
3.  **Replace Placeholders**: Manually replace `{...}` with actual values.

---
*(Steps 1-5 for creating Organization, Employee, and Customer are assumed to be complete as per `02.C-CURL-TESTS.md`)*

---
### Step 6: Create Patient's Predetermined Consent (Template with Advanced ODRL)

The patient defines their master access control rules. This `Consent`'s `id` should match the patient's `did:web` identifier. The ODRL policy is the core of the authorization logic.

#### ODRL Policy Explained

Here is a human-readable translation of the ODRL policy used in this example:

> "As the patient, I grant the following permissions to authorized professionals:
>
> 1.  **Permission to Send Messages:** You are permitted to `create` new `Communication` resources.
> 2.  **Permission to Update My Unified Health Index:** You are permitted to `update` my primary `Composition` resource, where the `identifier` of that `Composition` is exactly my personal `did:web`.
> 3.  **Permission to Read Radiology History:** You are permitted to `read` my past `Composition` sections, but **only if** all of the following conditions are met:
>     *   The section is LOINC 30954-2 Relevant diagnostic tests/laboratory data.
>     *   The resources were created within the last year (`section.date` is greater than or equal to one year ago).
> 4.  **Permission to See Related Appointment Responses:** You are permitted to `read` `AppointmentResponse` resources, but **only if** they are related to an appointment whose `serviceType` is part of the concrete department and location (optional) (e.g. `...startsWith("did:web:hospital-a.com:department:service-type:radiology")`)."

This policy is then encoded in Base64 and attached to the `Consent` resource.

#### `cURL` Command

```bash
# MANUALLY REPLACE:
# - {RECEPTIONIST1_ID_TOKEN}, {CUSTOMER_URN_UUID}, {ORGANIZATION_URN_UUID}, {PATIENT_DID_WEB}

curl -i --location --request POST 'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Consent' \
--header "Authorization: Bearer {RECEPTIONIST1_ID_TOKEN}" \
--header 'Content-Type: application/json' \
--data-raw '{
    "thid": "thid-consent-predetermined-final-3",
    "iss": "did:web:api.acme.org:employee:receptionist1@api.acme.org:role:ISCO-08|4226",
    "aud": "urn:antifraud:health-care:acme",
    "body": {
      "resourceType": "Consent",
      "id": "{PATIENT_DID_WEB}",
      "status": "active",
      "scope": { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/consentscope", "code": "patient-privacy" }] },
      "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/consentcategorycodes", "code": "comm" }] }],
      "patient": { "reference": "{CUSTOMER_URN_UUID}" },
      "performer": [{ "reference": "{ORGANIZATION_URN_UUID}" }],
      "sourceAttachment": {
        "contentType": "application/odrl+json",
        "data": "ewogICJAY29udGV4dCI6ICJodHRwOi8vd3d3LnczLm9yZy9ucy9vZHJsLmpzb25sZCIsCiAgIkB0eXBlIjogIkFncmVlbWVudCIsCiAgInBlcm1pc3Npb24iOiBbCiAgICB7CiAgICAgICJhY3Rpb24iOiAiY3JlYXRlIiwKICAgICAgInRhcmdldCI6ICJDb21tdW5pY2F0aW9uIgogICAgfSwKICAgIHsKICAgICAgImFjdGlvbiI6ICJ3cml0ZSIsCiAgICAgICJ0YXJnZXQiOiAiQ29tcG9zaXRpb24iLAogICAgICAiY29uc3RyYWludCI6IFt7CiAgICAgICAgImxlZnRPcGVyYW5kIjogIm9yZy5obDcuZmhpci5hcGkuQ29tcG9zaXRpb24uaWRlbnRpZmllciIsCiAgICAgICAgIm9wZXJhdG9yIjogImVxIiwKICAgICAgICAicmlnaHRPcGVyYW5kIjogIntQQVRJRU5UX0RJRF9XRUJ9IgogICAgICB9XQogICAgfSwKICAgIHsKICAgICAgImFjdGlvbiI6ICJyZWFkIiwKICAgICAgInRhcmdldCI6ICJDb21wb3NpdGlvbiIsCiAgICAgICJjb25zdHJhaW50IjogWwogICAgICAgIHsKICAgICAgICAgICJsZWZ0T3BlcmFuZCI6ICJvcmcuaGw3LmZoaXIuYXBpLkNvbXBvc2l0aW9uLnNlY3Rpb24uY29kZSIsCiAgICAgICAgICAib3BlcmF0b3IiOiAiaW4iLAogICAgICAgICAgInJpZ2h0T3BlcmFuZCI6IFsKICAgICAgICAgICAgIkxPSU5DOjMwOTU0LTIiCiAgICAgICAgICBdCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAibGVmdE9wZXJhbmQiOiAib3JnLmhsNy5maGlyLmFwaS5Db21wb3NpdGlvbi5zZWN0aW9uLmRhdGUiLAogICAgICAgICAgIm9wZXJhdG9yIjogImd0ZSIsCiAgICAgICAgICAicmlnaHRPcGVyYW5kIjogewogICAgICAgICAgICAiQHR5cGUiOiAiaHR0cDovL3d3dy53My5vcmcvMjAwMS9YTUxTY2hlbWEjZGF0ZVRpbWUiLAogICAgICAgICAgICAiQHZhbHVlIjogIlAtMVkiCiAgICAgICAgICB9CiAgICAgICAgfQogICAgICBdCiAgICB9LAogICAgewogICAgICAiYWN0aW9uIjogInJlYWQiLAogICAgICAidGFyZ2V0IjogIkFwcG9pbnRtZW50UmVzcG9uc2UiLAogICAgICAiY29uc3RyYWludCI6IFt7CiAgICAgICAgImxlZnRPcGVyYW5kIjogIm9yZy5obDcuZmhpci5hcGkuQXBwb2ludG1lbnQuc2VydmljZVR5cGUiLAogICAgICAgICJvcGVyYXRvciI6ICJzdGFydHNXaXRoIiwKICAgICAgICAicmlnaHRPcGVyYW5kIjogImRpZDp3ZWI6aG9zcGl0YWwtYS5jb206ZGVwYXJ0bWVudDpzZXJ2aWNlLXR5cGU6cmFkaW9sb2d5IgogICAgICB9XQogICAgfQogIF0KfQ=="
      },
      "provision": { "type": "permit" }
    }
}'
```

---
### Step 7: The OAuth `launch` Flow (Simulated for Radiology Use Case)

#### 7.1. Authorization Request (`/authorize`)

A radiologist's app requests a `launch/list` context and scopes matching the granular permissions needed.

```bash
curl -i --location --request POST 'http://localhost:3000/oauth/authorize' \
--header "Authorization: Bearer {RADIOLOGIST_ID_TOKEN}" \
--header 'Content-Type: application/didcomm-plaintext+json' \
--data-raw '{
  "iss": "did:web:radiology-app.com",
  "aud": "did:web:api.acme.org",
  "body": {
    "response_type": "code",
    "client_id": "radiology-app-789",
    "scope": "launch/list user/Composition.rs user/AppointmentResponse.rs patient/Communication.c",
    "state": "state456",
    "redirect_uri": "https://radiology-app.com/callback",
    "aud": "http://localhost:3002"
  }
}'
```
**Server Action (Conceptual):** The server validates the requested scopes against the patient's predetermined ODRL policy. Since the policy allows these actions (with constraints), it creates a FHIR `List` (e.g., `urn:uuid:channel-radiology-456`), an associated channel `Consent`, and returns an authorization `code`.

#### 7.2. Token Exchange (`/token`)
```bash
curl -i --location --request POST 'http://localhost:3000/oauth/token' \
--header "Authorization: Bearer {RADIOLOGIST_ID_TOKEN}" \
--header 'Content-Type: application/didcomm-plaintext+json' \
--data-raw '{
  "iss": "did:web:radiology-app.com",
  "aud": "did:web:api.acme.org",
  "body": {
    "grant_type": "authorization_code",
    "code": "mock-auth-code-from-radiology-launch",
    "redirect_uri": "https://radiology-app.com/callback"
  }
}'
```

**Expected Response (`200 OK`):**
```json
{
  "access_token": "mock-radiology-access-token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "launch/list user/Composition.rs user/AppointmentResponse.rs patient/Communication.c",
  "patient": "{CUSTOMER_INTERNAL_ID}",
  "fhirContext": [
    {
      "reference": "List/urn:uuid:channel-radiology-456",
      "type": "List"
    }
  ]
}
```

---
### Step 8: Send a `Communication` with a new Diagnostic Report

The radiologist's app uses the `access_token` and the `fhirContext` Channel ID to send a new `DiagnosticReport` to the patient, which will update their primary `Composition`.

```bash
# MANUALLY REPLACE:
# - {RADIOLOGY_ACCESS_TOKEN} with the token from step 7.2.
# - {CUSTOMER_URN_UUID}, {ORGANIZATION_URN_UUID} as before.
# - The CHANNEL_ID in "partOf.reference" must match the ID from the fhirContext.

curl -i --location --request POST 'http://localhost:3000/acme/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication' \
--header "Authorization: Bearer {RADIOLOGY_ACCESS_TOKEN}" \
--header 'Content-Type: application/json' \
--data-raw '{
  "thid": "thid-comm-diag-report-1",
  "iss": "did:web:api.acme.org:employee:radiologist1@api.acme.org:role:ISCO-08|2224",
  "aud": "urn:antifraud:health-care:acme",
  "body": {
    "resourceType": "Communication",
    "status": "completed",
    "partOf": [{ "reference": "urn:uuid:channel-radiology-456" }],
    "payload": [{
        "contentReference": {
          "reference": "DiagnosticReport/diag-report-789",
        }
    }]
  }
}'
```

**Expected Outcome:** `202 Accepted`.
