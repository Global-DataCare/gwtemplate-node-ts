# Integration Guide

This guide provides practical, step-by-step instructions for integrators to interact with the Gateway API. We will start with simple, plaintext JSON requests and progressively move to more secure, advanced use cases.

## 1. Your First Request: The Ping Endpoint

Before diving into complex operations, you can verify that the service is running and explore its content negotiation capabilities using the `ping` endpoint. This is a synchronous `GET` request that provides different responses based on your `Accept` header.

### 1.1. Plain JSON Response (`application/json`)

This is the most straightforward check. It returns the canonical JSON:API-style bundle.

```bash
curl 'http://localhost:3000/.well-known/ping' \
--header 'Accept: application/json'
```

**Expected Response:** A JSON:API-style bundle containing an OperationOutcome.
```json
{
  "type": "batch-response",
  "meta": { ... },
  "data": [ ... ]
}
```

### 1.2. FHIR Bundle Response (`application/fhir+json`)

This demonstrates the API's ability to serve FHIR-compliant responses.

```bash
curl 'http://localhost:3000/.well-known/ping' \
--header 'Accept: application/fhir+json'
```

**Expected Response:** A FHIR Bundle with the `data` array transformed into an `entry` array.
```json
{
  "resourceType": "Bundle",
  "type": "batch-response",
  "total": 1,
  "entry": [ ... ]
}
```

### 1.3. JARM/FAPI Response (`application/x-www-form-urlencoded`)

This demonstrates the secure response format, wrapping the entire JARM payload in an unsigned JWS.

```bash
curl 'http://localhost:3000/.well-known/ping' \
--header 'Accept: application/x-www-form-urlencoded'
```

**Expected Response:**
```
response=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ0aGlkIjoicGluZy0xNj...
```

---

## 2. API Fundamentals

Before making your first call, it's important to understand two core concepts.

### 2.1. Asynchronous Flow

All state-changing operations (like creating a tenant or an employee) are **asynchronous**. The flow is always the same:

```bash
curl 'http://localhost:3000/tenant/cds-<jurisdiction/v1/test/ping/standard/resource/_batch' \
--header 'Accept: application/x-www-form-urlencoded'
```

1.  **`POST /.../_batch`**: You submit a job.
2.  **`202 Accepted` Response**: The server immediately responds with a `Location` header.
3.  **Polling**: You poll the `Location` URL to get the final result.

### 2.2. Request Modes: Plaintext vs. Secure DIDComm

The API supports two modes for submitting jobs:

-   **Plaintext Mode (`Content-Type: application/json`)**: Ideal for development and testing.
-   **Secure Mode (`Content-Type: application/x-www-form-urlencoded`)**: Production-grade FAPI/DIDComm flow.

---

## 3. Your First Task: Registering a New Tenant

Our first goal is to register a new organization, "Acme Health".

### 3.1. Construct the Request Body

We will create a file named `acme-registration.json`.

**Key Parts of the Payload:**

-   `thid`: A unique transaction ID you generate.
-   `iss` / `aud`: Your DID and the API's DID.
-   `body.data[].meta.claims`: A flat list of the core claims.

```json acme-registration.json
{
  "thid": "a2a89321-1247-4467-9a7a-6b5d9d7e7d4d",
  "iss": "did:web:admin-tool.example.com",
  "aud": "did:web:api.example.com",
  "body": {
    "data": [
      {
        "type": "Organization-registration-form-v1.0",
        "meta": {
          "claims": {
            "org.schema.Organization.identifier": "acme-org-id",
            "org.schema.Organization.alternateName": "acme",
            "org.schema.Organization.legalName": "Acme Health Inc."
          }
        }
      }
    ]
  }
}
```

### 3.2. Send the Request with `curl`

```bash
curl -X POST 'http://localhost:3000/host/cds-es/v1/test/registry/org.schema/Organization/_batch' \
--header 'Content-Type: application/json' \
--data '@acme-registration.json' \
--verbose
```

### 3.3. Interpret the Response

The server should respond with `HTTP/1.1 202 Accepted` and a `Location` header.

### 3.4. Poll for the Result

Use the `Location` URL and the `thid` to check the status of your registration job.

```bash
curl -X POST 'http://localhost:3000/host/cds-es/v1/test/registry/org.schema/Organization/_batch-response' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--data-raw 'thid=a2a89321-1247-4467-9a7a-6b5d9d7e7d4d'
```

---
*Next, we will add a chapter on how to use the newly created "acme" tenant to perform an operation.*
