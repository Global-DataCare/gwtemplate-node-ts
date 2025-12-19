// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/example-payloads.ts

import { testClaimsOfferEntityExpanded, testClaimsOfferFamilyExpanded } from './offer.data';
import { testClaimsRegisterTenantExpanded } from './organization.data';
import { testFamilyRegisterExpanded } from './family.data';


/**
 * @file This file serves as the Single Source of Truth for all complex test payloads
 * and examples used across integration tests, cURL documentation, and Swagger specs.
 * It is designed to be a 1:1 representation of the payloads described in the
 * `docs/API_INTEGRATORS_GUIDE.md`, while also retaining other payloads used in tests.
 */

// --- Reusable Constants ---

const pdfEmbeddedData = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKMTAwIDEwMCBUZAooSGVsbG8gUERGKSBUagoKRVQKZW5kc3RyZWFtCmVuZGiago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNTMgMDAwMDAgbiAKMDAwMDAwMDEwNiAwMDAwMCBuIAowMDAwMDAwMjU1IDAwMDAwIG4gCjAwMDAwMDAzNDMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDMKJSVFT0Y=";

const deviceKidMldsa = "thumbprint-public-sig-key-device";
const deviceJwkMldsa = {
  "alg": "ML-DSA-44",
  "kid": deviceKidMldsa,
  "kty": "AKP",
  "pub": "base64url-public-sig-key-device",
  "use": "sig",
} as const;

const deviceKidMlkem = "thumbprint-public-enc-key-device";
const deviceJwkMlkem = {
  "crv": "ML-KEM-768",
  "kid": deviceKidMlkem,
  "kty": "OKP",
  "use": "enc",
  "x": "base64url-public-enc-key-device",
} as const;

const deviceJWKeySet = {
  "keys": [
    { ...deviceJwkMldsa },
    { ...deviceJwkMlkem }
  ]
};

/**
 * Meta object for a request where the client provides its full JWKs.
 * Used for initial registration. The top-level `kid` is mandatory alongside the
 * `jwk` so the server can cache the key for future use.
 */
export const metaRequestBodyFullJWK = {
  "jwe": {
    "header": {
      "jwk": { ...deviceJwkMlkem },
    }
  },    
  "jws": {
    "protected": {
      "alg": deviceJwkMldsa.alg,
      "kid": deviceKidMldsa,
      "jwk": { ...deviceJwkMldsa },
    }
  }
};

/**
 * Meta object for subsequent requests where the client's keys are already registered.
 * The client identifies its keys using the `kid` property.
 */
const metaRequestBodyOnlyKidHeader = {
  "jwe": {
    "header": {
      "skid": deviceKidMlkem,
    }
  },    
  "jws": {
    "protected": {
      "alg": deviceJwkMldsa.alg,
      "kid": deviceKidMldsa,
    }
  }
};


// --- 1. Organization Onboarding ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.1
 * Initial request to register a new tenant organization.
 */
export const ORGANIZATION_REGISTRATION_REQUEST = {
  "jti": "org-registration-request-id",
  "thid": "org-registration-thread-id",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Organization-registration-form-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "@type": "template",
          ...testClaimsRegisterTenantExpanded,
          "org.schema.Service.termsOfService": pdfEmbeddedData,
        },
      },
    }],
  },
  "meta": { ...metaRequestBodyFullJWK }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.1
 * The response to a successful registration request, containing the Offer.
 */
export const ORGANIZATION_REGISTRATION_RESPONSE = {
  "jti": "org-registration-response-id",
  "thid": "org-registration-thread-id",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:host.example.com#v1_<network>_registry_org.schema_organization_batch",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Organization-registration-offer-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "@type": "receipt",
          "org.schema.Service.termsOfService": "<url-stored-pdf>",
          ...testClaimsOfferEntityExpanded,
        }
      }
    }]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Request to accept the registration offer and create an order.
 */
export const ORGANIZATION_ORDER_REQUEST = {
  "jti": "org-order-request-id",
  "thid": "org-order-thread-id",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Organization-order-request-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "Order.acceptedOffer.identifier": "urn:cds-<jurisdiction>:v1:<sector>:product:org.schema:Offer:<offer-uuid>",
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Response to a successful order request, containing the payment URL.
 */
export const ORGANIZATION_ORDER_RESPONSE = {
  "jti": "org-order-response-id",
  "thid": "org-order-thread-id",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "url": "<payment-url>"
  }
};


// --- 2. Device and Identity Registration ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The inner body of a Device Registration (DCR) request.
 */
export const DCR_REQUEST_BODY = {
  "application_type": "native",
  "client_name": "App for [email] as [role] on [iOS, Android, Web]",
  "code": "<license-code>",
  "redirect_uris": ["myapp://callback"],
  "token_endpoint_auth_method": "private_key_jwt",
  "ext_device_info": {
    "device_id": "iOS-17.1.2-ABC-123",
    "device_name": "User's iPhone 15 Pro",
    "os": "iOS",
    "os_version": "17.1.2",
    "push_provider": "expo",
    "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
  },
  "jwks": { ...deviceJWKeySet },
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The full DIDComm message for a Device Registration (DCR) request.
 */
export const DEVICE_REGISTRATION_REQUEST = {
  "jti": "device-registration-request-id",
  "thid": "device-registration-thread-id",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:api.acme.org#identity_openid_device_dcr",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": { ...DCR_REQUEST_BODY },
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The final response to a DCR request, containing the new client_id.
 */
export const DEVICE_REGISTRATION_RESPONSE = {
  "jti": "device-registration-response-id",
  "thid": "device-registration-thread-id",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "client_id": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>"
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.2
 * A request for a scoped SMART access token.
 */
export const SMART_TOKEN_REQUEST = {
  "jti": "smart-token-request-id",
  "thid": "smart-token-thread-id",
  "iss": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "expires_in": 300,
    "token_type": "Bearer",
    "sub": "did:web:api.acme.org",
    "scope": "organization/PractitionerRole.crus"
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};


// --- 3. End-to-End Business Flows ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.1
 * Request to create a new employee role.
 */
export const EMPLOYEE_REGISTRATION_REQUEST = {
  "jti": "employeerole-registration-request-id",
  "thid": "employeerole-registration-thread-id",
  "iss": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Employee-form-v1.0",
      "meta": {
        "claims": {
          "org.schema.Person.identifier": "urn:uuid:11b2c3d4-e5f6-7890-1234-567890abcdef",
          "org.schema.Person.hasOccupation": "ISCO-08:4226",
          "org.schema.Person.email": "receptionist1@acme.org"
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.2
 * Initial request to register a new family organization.
 */
export const FAMILY_REGISTRATION_REQUEST = {
  "jti": "family-registration-request-id",
  "thid": "family-registration-thread-id",
  "iss": "adult1@example.com",
  "aud": "did:web:api.acme.org",
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Family-registration-form-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "@type": "template",
          ...testFamilyRegisterExpanded,
          "org.schema.Service.termsOfService": pdfEmbeddedData,
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyFullJWK }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.2.1
 * Request to confirm the family registration via an Order.
 */
export const FAMILY_ORDER_REQUEST = {
  "jti": "family-order-request-id",
  "thid": "family-order-thread-id",
  "iss": "adult1@example.com",
  "aud": "did:web:api.acme.org",
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Family-order-request-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "Order.acceptedOffer.identifier": "urn:cds-<jurisdiction>:v1:health-care:product:org.schema:Offer:<family-offer-uuid>"
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};


// --- Other Payloads (Retained for existing tests) ---

export const CUSTOMER_ONBOARDING_MESSAGE = {
  jti: "unique-customer-onboard-message-id",
  thid: "thread-onboarding-customer-id",
  iss: "did:web:acme.org:employee:...",
  aud: "did:web:acme.org",
  type: "application/api+json",
  body: {
    data: [{
      type: "Individual-terms-v1.0",
      meta: {
        claims: {
          "org.schema.Person.alternateName": "Joe",
          "org.schema.Person.identifier": "urn:uuid:8e0d846a-2492-4b9c-8a4e-5e065fb6ba76",
          "org.schema.Person.email": "customer1@example.com",
          "org.schema.Service.category": "health-care",
          "org.schema.Service.serviceType": "http://terminology.hl7.org/CodeSystem/v3-ActReason|FAMRQT,PWATRNY,METAMGT,FRAUD,RECORDMGT,COVAUTH,TREAT,DISASTER,HPAYMT,MLTRAINING,ETREAT,HOPERAT,CAREMGT,HSYSADMIN,PATADMIN,PATSFTY",
          "org.schema.Service.termsOfService": pdfEmbeddedData,
        },
      },
      request: {
        method: "POST",
        url: "individual/org.schema/Person/"
      },
    },
    {
      type: "Personal-identity-v1.0",
      meta: {
        claims: {
          "org.schema.Person.identifier": "urn:uuid:8e0d846a-2492-4b9c-8a4e-5e065fb6ba76",
          "org.schema.Person.identifierType": "NNES",
          "org.schema.Person.identifierValue": "12345678X",
        },
      },
      request: {
        method: "POST",
        url: "individual/org.schema/Person/"
      },
    }],
  },
};

export const CONSENT_CREATION_MESSAGE = {
  jti: "unique-consent-fhir-message-id",
  thid: "thread-consent-fhir-batch-id",
  iss: "did:web:ehr-system.example.com",
  aud: "did:web:gateway.example.com",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      url: "https://ehr-system.example.com/fhir/r4/Consent/patient-consent-uuid",
      type: "Consent",
      meta: {
        claims: {
          "@context": "org.hl7.fhir.api",
          "Consent.decision": "permit",
          "Consent.subject": "unified-health-id",
          "Consent.identifier": "urn:uuid:patient-consent-uuid",
          "Consent.grantee": "did:web:hospital.example.com",
          "Consent.date": "2025-11-25",
          "Consent.purpose": "TREAT",
          "Consent.action": "LOINC|48765-2",
          "Consent.actor-identifier": "did:web:hospital.example.com",
          "Consent.actor-role": "ISCO-08|2221",
          "Consent.attachment-contentType": "application/odrl+json",
          "Consent.attachment-data": "eyAiQGNvbnRleHQiOiAiaHR0cDovL3d3dy53My5vcmcvbnMvb2RybC5qc29ubGQiLCAiQHR5cGUiOiAiQWdyZWVtZW50Ii...sgIlRSRUFUIiB9XSB9XSB9"
        }
      },
      request: {
        method: "POST",
        url: "/health-care/individual/org.hl7.fhir.api/Consent"
      },
      resource: {
        identifier: "urn:uuid:patient-consent-uuid",
        resourceType: "Consent",
        status: "active",
        scope: {
          coding: [{
            system: "http://terminology.hl7.org/CodeSystem/consentscope",
            code: "patient-privacy"
          }]
        },
        category: [{
          coding: [{
            system: "http://terminology.hl7.org/CodeSystem/consentcategorycodes",
            code: "TREAT"
          }]
        }],
        patient: { reference: "unified-health-id" },
        performer: [{ reference: "did:web:hospital.example.com" }],
        provision: { type: "permit" },
        sourceAttachment: {
          contentType: "application/odrl+json",
          data: "eyAiQGNvbnRleHQiOiAiaHR0cDovL3d3dy53My5vcmcvbnMvb2RybC5qc29ubGQiLCAiQHR5cGUiOiAiQWdyZWVtZW50Ii...sgIlRSRUFUIiB9XSB9XSB9"
        },
      },
    }]
  }
}

export const COMMUNICATION_CREATION_MESSAGE = {
  jti: "unique-communication-message-id",
  thid: "thread-communication-id",
  iss: "did:web:ehr-system.example.com",
  aud: "did:web:gateway.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      type: "Communication",
      meta: {
        claims: {
          "@context": "org.hl7.fhir.api",
          "@type": "Communication:Appointment",
          "Communication.category": "http://terminology.hl7.org/CodeSystem/communication-category|appointment-reminder",
          "Communication.content-attachment-data": "QkVHSU4...5EQVI=",
          "Communication.content-attachment-title": "appointment-details.ics",
          "Communication.content-attachment-type": "text/calendar",
          "Communication.content-reference": "https://url-to-appointment-source.com/some-uuid",
          "Communication.partOf": "urn:uuid:communication-channel-id",
          "Communication.recipient": "{CUSTOMER_DID_WEB}",
          "Communication.sender": "{ORGANIZATION_DID_WEB}",
          "Communication.sent": "2025-10-15T14:30:00Z",
          "Communication.subject": "{CUSTOMER_DID_WEB}",
          "Communication.text": "This is your new appointment. Best regards."
        }
      },
      request: {
        method: "POST",
        url: "individual/org.hl7.fhir.r4/Communication"
      },
      resource: {
        resourceType: "Communication",
        status: "completed",
        partOf: [{ reference: "urn:uuid:communication-channel-id" }],
        category: [{
          coding: [{
            code: "appointment-reminder",
            system: "http://terminology.hl7.org/CodeSystem/communication-category"
          }]
        }],
        recipient: [{ reference: "{CUSTOMER_DID_WEB}" }],
        sender: { reference: "{ORGANIZATION_DID_WEB}" },
        sent: "2025-10-15T14:30:00Z",
        note: [{ text: "This is your new appointment. Best regards." }],
        payload: [
          {
            contentReference: {
              reference: "https://url-to-appointment-source.com/some-uuid"
            }
          },
          {
            contentAttachment: {
              contentType: "text/calendar",
              data: "QkVHSU46VkNBTEVOREFSCgpWRVJTSU9OOjIuMApQUk9ESUQ6LS8vQWNtZS8vZGlkOndlYjphcGkuYWNtZS5vcmcvL0VTCkJFR0lOOlZFVkVOVApVSUQ6PHV1aWQtdjQ+CkRUU1BTVA6MjAyNTEwMTZUMTIwMDAwWgpEVFNUQVJUOjIwMjUxMDE3VDE1MDAwMFoKRF RFTkQ6MjAyNTEwMTdUMTYwMDAwWgpTVU1NQVJZOlJlc3VtZW4gZGUgY2l0YS4KREVTQ1JJUFRJT046RW5jdWVudHJvIHZpcnR1YWwuCkxPQ0FUSU9OOk9ubGluZQpFTkQ6VkVWRU5UCkVORDpWQ0FMRU5EQVI=",
              title: "appointment-details.ics"
            }
          }
        ]
      }
    }]
  }
};
