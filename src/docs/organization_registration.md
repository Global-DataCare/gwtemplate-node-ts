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

### 3.1 Input (Decoded Request Payload)

The `input` for the job is the plaintext, decoded DIDComm message. It contains top-level properties that control the response format and mode, along with the `body` which is the `Bundle` of entries.

**Example Decoded Payload:**
```json
{
  "aud": "did:web:antifraud.example.com",
  "iss": "did:web:client.example.com",
  "response_type": "json",
  "response_mode": "form_post.jwt",
  "thid": "test-thid-123",
  "type": "https://didcomm.org/registration/1.0/register",
  "body": {
    "type": "Organization-registration-form-v1.0",
    "data": [{
      "meta": { "claims": { "..." : "..." } }
    }
  }
}
```

#### Flat Claims for Structured Data

To represent structured `schema.org/PropertyValue` data within a simple key-value format, the system uses a FHIR-inspired flat claim pattern: `SYSTEM|VALUE`. For a property that accepts multiple values, the values are comma-separated.

The `OrganizationManager` is responsible for parsing this flat format. For example, if it receives a claim like this:
`"org.schema.Service.additionalProperty": "net.openid.connect.discovery.response_modes_supported|form_post.jwt,json"`

It will parse it internally to validate its components against the structured `PropertyValue` model.

#### Claim Processing and Validation Rules
The `OrganizationManager` must enforce a specific set of rules when processing the `additionalProperty` claim for `net.openid.connect.discovery.response_modes_supported`. This ensures the resulting configuration is always valid, secure, and predictable.

1.  **Default Behavior:** If the `additionalProperty` claim is not provided, it will be defaulted to `form_post.jwt`.
2.  **Guaranteed Primary Mode:** The `form_post.jwt` mode is always required. If the claim is present but does not include `form_post.jwt`, it will be added. The final list of modes will also be sorted to ensure `form_post.jwt` is the first element.
3.  **Sanitization:** Only modes from a known allowlist (e.g., `form_post.jwt`, `json`, `fhir+json`) will be accepted. Any unsupported modes included in the claim will be silently removed.

**Examples:**
*   **Input:** `(claim not provided)`
    **Accepted Claim:** `"net.openid...|form_post.jwt"`
*   **Input:** `"net.openid...|fhir+json"`
    **Accepted Claim:** `"net.openid...|form_post.jwt,fhir+json"`
*   **Input:** `"net.openid...|json,xml,form_post.jwt"`
    **Accepted Claim:** `"net.openid...|form_post.jwt,json"`

### 3.2 Response Control Properties

*   `response_type` (Required): Determines the content format of the response bundle.
    *   `"json"`: The bundle will be JSON:API compliant, using a `data` array for its entries.
    *   `"fhir+json"`: The bundle will be FHIR compliant, using an `entry` array.
*   `response_mode` (Required): Determines the response delivery mechanism.
    *   `"form_post.jwt"`: (Default) The standard asynchronous flow. The service returns a `202 Accepted`, and the client polls for the final response JWT using the `thid` in an HTTP POST request, e.g. `http://localhost:3000/host/cds-<jurisdiction>/<sector>/registry/org.schema/Organization/_search` con parameter "thid=<uuid>"
    *   `"jwt"`: The response JWT is returned directly in the body of the HTTP response.

### 3.3 Output (`IPayloadResponse`)

The entire response from the manager is a JARM-compliant `IPayloadResponse` object. The `body` of this object is a `Bundle`.

**Example Full Success Response Payload:**
```json
{
  "thid": "test-thid-123",
  "body": {
    "type": "batch-response",
    "total": 1,
    "data": [
      {
        /* BundleEntry content goes here, see below */
      }
    ]
  }
}
```
**Note on Response Formatting (`data` vs. `entry`):**
*   The `total` field indicates the total number of entries processed, including both successes and errors.
*   The array containing the results will be named **`data`** or **`entry`** based on the `response_type` property in the original request.
*   **Legacy Mode Fallback:** In `LEGACY_MODE=true`, if `response_type` is omitted from the payload, the system will fall back to inspecting the HTTP `Accept` header (e.g., `application/fhir+json` will produce the `entry` field).

### 3.4 Example Entries

**Example Success Entry (`BundleEntry`):**
```json
{
  "type": "Organization-registration-form-v1.0",
  "resource": {
    /* The principal resource */
  "id": "urn:uuid:<organization-uuid>",
    "meta": { "claims": { /* Processed claims for the principal resource */ } },
    "resourceType": "Organization",

    /* Additional resources included including processed claims */
    "contained": [{
      "id": "urn:uuid:<employee-uuid>",
      "meta": { "claims": { "org.schema.Person.email": "<email>" } },
      "type": "Person",
     }, {
      "id": "urn:uuid:<role-uuid>",
      "meta": { "claims": { "org.schema.Occupation.occupationalCategory": "ISCO-08:<code>" } },
      "type": "Occupation",
    }
  }],
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
      "issue": [{
        "severity": "error",
        "code": "duplicate",
        "diagnostics": "Conflict: already exists the taxID '<taxId>' issued by '<country_code>' jurisdiction"
      }
    }
  }
}
```

## 4. Architectural Patterns & Modes

## 5. AI Prompt Guide
When generating code, use the following guidelines:

*   **Language:** TypeScript
*   **Responsibilities:** Follow the component responsibilities outlined in `ARCHITECTURE_PATTERNS.md`.
*   **Data Structures:** Adhere to the data structures defined in this document. The output of the `OrganizationManager` MUST be a `Promise<IPayloadResponse>`.
*   **Error Handling:** Implement robust error handling using the custom `ManagerError`.

**Example Prompt for AI:**

"Create a TypeScript class `OrganizationManager`. Its `register` method must accept a `JobRequest` object and return a `Promise<IPayloadResponse>`. The method should validate the input data from `job.input.body`, separate claims into resources, generate identifiers, and build the final `IPayloadResponse` as defined in the 'Organization Registration Process Documentation'."

