# Organization Registration Process Documentation

This document provides a comprehensive overview of the organization registration process, including the data flow, component responsibilities, and usage as a prompt for developers.

## 1. Overview

The organization registration process allows administrators to register new organizations (tenants) within the system. The process involves collecting organization details, user information, and consent, then structuring this data and processing it on the backend. This document outlines the steps involved and the responsibilities of each component.

## 2. Data Flow

1.  **Frontend Form:** The user interacts with a template-driven form on the frontend application to input organization details, administrator information, and consent.
2.  **DIDComm Message Creation:** The external application encapsulates the collected data within a DIDComm message. The `thid` (thread ID) is included for tracking.
3.  **API Endpoint:** The backend receives the DIDComm message (e.g., as a JWE/JWS) at a dedicated API endpoint (e.g., `.../host/cds-<jurisdiction>/v1/<sector>/registry/org.schema/Organization/_batch`).
4.  **Message Decoding:** The backend's security layer decodes and verifies the message, resulting in a plaintext `DecodedDidcommMessage` object. This object is the `requestPayload`.
5.  **Job Creation:** The API layer creates a `JobRequest` object, which contains the `requestPayload` (`job.input`) and other contextual information from the HTTP request.
6.  **Manager Processing:** The job is passed to the `OrganizationManager`. The manager validates data, separates claims, generates identifiers, and orchestrates data persistence.
7.  **Response Payload Creation:** The manager constructs and returns a complete `IPayloadResponse` object, which is a JARM-compliant payload containing the results of the operation in a `Bundle`.
8.  **Response Securing:** A `Worker` process takes the `IPayloadResponse`, passes it to the `IKmsService` to create a `secureEnvelope` (JWE/JWS).
9.  **Response Storage & Polling:** The `secureEnvelope` is stored, keyed by the `thid`, for the client to retrieve via a polling mechanism.

## 3. Data Structures

### 3.1 Input (`requestPayload.body`)

The `body` of the incoming `DecodedDidcommMessage` is expected to be a `Bundle` containing one or more entries. The `type` of the entry identifies the form and version.

**Example Entry:**
```json
{
  "type": "Organization-registration-form-v1.0",
        "meta": {
          "claims": {
            "@claims": "org.schema",
            "@type": "template",
            "org.schema.Organization.legalName": "Example Corp",
      "org.schema.Organization.alternateName": "example-corp",
      "..." : "..."
          }
        }
      }
```

### 3.2 Output (`responsePayload.body`)

The `body` of the outgoing `IPayloadResponse` is a `Bundle` of type `batch-response`. For each successful registration, it contains a `BundleEntry` of type `Organization-registration-receipt-v1.0`.

**Example Success Entry (`BundleEntry`):**
```json
{
  "type": "Organization-registration-receipt-v1.0",
  "id": "receipt-uuid-...",
        "resource": {
          "resourceType": "Organization",
    "id": "org-uuid-...",
    "meta": { "claims": { "..." } },
          "contained": [
      { "type": "Person", "id": "person-uuid-...", "meta": { "claims": { "..." } } }
          ]
        },
        "response": {
          "status": "201"
        }
      }
```

**Example Error Entry (`ErrorEntry`):**
```json
{
  "type": "Organization-registration-form-v1.0",
  "response": {
    "status": "409",
    "outcome": {
      "resourceType": "OperationOutcome",
      "issue": [
        {
          "severity": "error",
          "code": "duplicate",
          "diagnostics": "An organization with the same taxID already exists."
        }
      ]
    }
  }
}
```

## 4. AI Prompt Guide
When generating code, use the following guidelines:

*   **Language:** TypeScript
*   **Responsibilities:** Follow the component responsibilities outlined in `ARCHITECTURE_PATTERNS.md`.
*   **Data Structures:** Adhere to the data structures defined in this document. The output of the `OrganizationManager` MUST be a `Promise<IPayloadResponse>`.
*   **Error Handling:** Implement robust error handling using the custom `ManagerError`.

**Example Prompt for AI:**

"Create a TypeScript class `OrganizationManager`. Its `register` method must accept a `JobRequest` object and return a `Promise<IPayloadResponse>`. The method should validate the input data from `job.input.body`, separate claims into resources, generate identifiers, and build the final `IPayloadResponse` as defined in the 'Organization Registration Process Documentation'."

