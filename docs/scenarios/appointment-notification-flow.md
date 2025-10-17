# Scenario: Secure Appointment Notification with Calendar Attachment (FHIR)

This document describes the end-to-end architectural flow for a healthcare provider (e.g., a hospital's EMR system) to securely send an appointment notification to a patient using the HL7 FHIR `Communication` resource. This includes attaching a calendar file (`.ics`) for easy import into the personal calendar.

This scenario leverages the `Person`, FHIR `Communication` resource, and the established asynchronous API patterns.

## Actors

-   **Individual**: The individual who has been onboarded and has a `Person` resource in the system, identified by a `urn:uuid`.
-   **EMR System (Tenant)**: The healthcare provider's system, acting as an API client. It is authenticated and authorized to send communications.

## High-Level Flow

1.  The EMR System creates a new appointment for the Individual in its own internal database. This is the **source of truth**.
2.  The EMR System constructs a FHIR `Communication` resource to notify the patient or legal representive(s). This resource contains essential details and a `payload` that includes both a descriptive text and a Base64-encoded `.ics` file as a `contentAttachment`.
3.  The EMR System sends this FHIR resource to the gateway via a `POST` request to the `.../individual/org.hl7.fhir.r4/Communication/_batch` endpoint (for a Bundle of batch operations, but sole  `.../individual/org.hl7.fhir.r4/Communication/` without action in case of single resource could be enabled for specific use cases).
4.  The gateway processes the request asynchronously. It validates the FHIR resource and translates it into an internal `DIDCommMessageExtended` format.
5.  The message is delivered to the individual's logical "index" (confidential storage) within the system of the authorized service provider (tenant).
6.  The patient's mobile app receives a push notification, fetches the new message, and displays the appointment details from the payload.
7.  The app recognizes the `.ics` attachment and presents an "Accept and add to calendar" option, "Reject" or "Change". When accepted, the app decodes the Base64 data and hands it off to the mobile OS to be added to the native calendar application.

## FHIR to DIDCommExtended Mapping

A key part of this architecture is the translation of a standard HL7 FHIR `Communication` resource into a secure, internal `DIDCommExtendedMessage` that is stored in the user's confidential storage. This provides a clean separation between the healthcare standard (FHIR) and the secure messaging transport (DIDComm).

The mapping is as follows:

| FHIR `Communication` Field | DIDCommExtended JWT Claim/Header | Format / Comment |
| :--- | :--- | :--- |
| `identifier` | `thid` (thread ID) | |
| `subject` (the patient) | `sub` (subject) | |
| `recipient` (Reference to Individual) | `to` | |
| `sender` (Reference to Organization)| `from` | |
| `sent` | `nbf` (not before) | Unix timestamp. |
| `inResponseTo` | `pthid` (parent thread ID) | |
| `category` (CodeableConcept[]) | `category` | Comma-separated string in `system|code` format. |
| `payload` (array) | `body.data` | JSON:API formatted array. |


## Phase 2: Patient Response and Status Polling

The initial notification is only the first half of the interaction. The process is not complete until the patient confirms, cancels, or reschedules the appointment. This creates a long-running, stateful job that the original EMR system needs to monitor.

### High-Level Response Flow

1.  **Patient Action**: The patient's app, after displaying the appointment, presents `Accept` and `Cancel` options.
2.  **Response Message**: When the user taps an option, the app constructs a new `CommMsgExtended` message. This is **not** a FHIR resource, but a simple, structured response.
    -   The `thid` of the response **must be the same** as the original notification's `thid` to correlate the conversation.
    -   The `to` field is the DID of the EMR system (the `from` of the original message).
    -   The `from` field is the DID of the individual.
    -   The `body.data` contains a simple `AppointmentResponse` resource with the new status (`booked` for accepted, `cancelled` for declined).
3.  **Gateway Ingestion**: The app sends this response message to the gateway.
4.  **Worker Processing**: A worker processes the response. It identifies the original job using the `thid`, updates its status, and potentially notifies the EMR system via a webhook or makes the status available for polling.

### Asynchronous Job State Management

To allow the EMR to poll for the status of the appointment without breaking the end-to-end encryption of the payload, certain metadata fields on the stored job object (`ConfidentialDocument`) must be stored unencrypted.

| Unencrypted Metadata Field | Purpose | Example Values |
| :--- | :--- | :--- |
| `thid` | Job Correlation ID | `urn:uuid:c26e2a2a-6531-4a1f-a185-8a014a6316f7` |
| `status` | Current state of the appointment | `proposed`, `pending`, `booked`, `cancelled`, `noshow` |
| `type` | Type of resource | `Appointment`, `Communication` |
| `owner`| The DID of the owner of the document | `did:web:uhc-es.com:services:health-care:u:1234`|
| `updated` | Timestamp of last status change | `2024-10-15T14:45:00Z` |

The `status` field is derived from the official [FHIR AppointmentStatus ValueSet](http://hl7.org/fhir/ValueSet/appointmentstatus).

### EMR Polling Endpoint

The EMR can periodically query a new endpoint to get the latest status of the job.

**Request:**
`GET /status/{thid}`

**Response (for a pending appointment):**
```json
{
  "thid": "urn:uuid:c26e2a2a-6531-4a1f-a185-8a014a6316f7",
  "status": "pending",
  "type": "Appointment",
  "updated": "2024-10-15T14:30:00Z"
}
```

This mechanism allows the external system to track the progress of the appointment lifecycle without ever having access to the encrypted PII/PHI exchanged between the gateway and the individual.

## Detailed Architectural Steps & Payloads

### Step 1: EMR Constructs the FHIR `Communication` Resource

The EMR system generates the `.ics` file content, Base64 encodes it, and then builds the `meta.claims` payload containing the FHIR `Communication` resource.

**Example `meta.claims` Payload:**
```json
{
    "resourceType": "Communication",
    "status": "completed",
    "category": [
        {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/communication-category",
                    "code": "appointment-reminder"
                }
            ]
        }
    ],
    "recipient": [ { "reference": "urn:uuid:<patient-person-id>" } ],
    "sender": { "reference": "did:web:hospital-emr.com" },
    "sent": "2024-10-15T14:30:00Z",
    "note": [{ "text": "Your Cardiology appointment is for Jan 15th, 2026 at 10:30 AM." }],
    "payload": [
        {
            "contentReference": {
                "contentType": "text/calendar",
                "data": "QkVHSU46VkNBTEVOREFSLi4uRU5EOlZDQUxFTkRBUg==",
                "title": "appointment-details.ics"
            }
        },      
        {
            "contentAttachment": {
                "contentType": "text/calendar",
                "data": "QkVHSU46VkNBTEVOREFSLi4uRU5EOlZDQUxFTkRBUg==",
                "title": "appointment-details.ics"
            }
        }
    ]
}
```

### Step 2: EMR Submits the Request

The EMR sends a `POST` request to `/tenant-emr/cds-es/v1/health-care/individual/org.hl7.fhir.r4.core/Communication/_batch`. The body is a signed and encrypted JWE containing an array with the single `meta.claims` payload shown above.

### Step 3: Gateway Responds and Processes

-   The gateway immediately responds with `202 Accepted`.
-   The `Worker` dequeues the job and routes it to the `CommunicationManager`.
-   The manager's `FHIRAdapter` validates and transforms the FHIR resource into the `DIDCommExtendedMessage` format.

### Step 4: Stored Confidential Storage Object

The resulting object stored in the patient's vault is a clean, client-friendly `DIDCommExtendedMessage`. Note the flattened `category` and the JSON:API structure of the `body`.

**Example Stored Object:**
```json
{
  "thid": "urn:uuid:c26e2a2a-6531-4a1f-a185-8a014a6316f7",
  "to": ["urn:uuid:<patient-person-id>"],
  "from": "urn:did:web:hospital-emr.com",
  "sub": "urn:uuid:<patient-person-id>",
  "nbf": 1729002600,
  "category": "http://terminology.hl7.org/CodeSystem/communication-category|appointment-reminder",
  "note": [{ "text": "Your Cardiology appointment is for Jan 15th, 2026 at 10:30 AM." }],
  "body": {
    "data": [
      {
        "type": "org.hl7.fhir.r4.Reference",
        "id": "<appointment-uuid>",
        "resource": {
          "reference": "url-to-original-appointment",
          "type": "Appointment"
        }
      },
      {
        "type": "org.hl7.fhir.r4.Attachment",
        "id": "<attachment-uuid>",
        "resource": {
          "contentType": "text/calendar",
          "data": "QkVHSU46VkNBTEVOREFSLi4uRU5EOlZDQUxFTkRBUg==",
          "title": "appointment-details.ics", // filename
        }
      },
    ]
  }
}
```

### Step 5: Individual App Interaction

-   The patient's app fetches the decrypted `DIDCommExtendedMessage`.
-   It parses the `body.data` array, identifying resources by their `type`.
-   It displays the content of the `Annotation`.
-   It detects the `Attachment` with `contentType: "text/calendar"` and renders an "Add to Calendar" button.
-   On user interaction, it decodes the `resource.data` field (Base64) and initiates the OS-level calendar import.

This pattern demonstrates a secure, robust, and user-friendly way to handle healthcare notifications while adhering to interoperability standards like HL7 FHIR.
