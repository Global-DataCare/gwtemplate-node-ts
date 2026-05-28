// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
// File: src/__tests__/data/example-payloads.ts

import { testClaimsOfferEntityExpanded, testClaimsOfferFamilyExpanded } from './offer.data';
import { testClaimsRegisterTenantExpanded } from './organization.data';
import { testFamilyRegisterExpanded } from './family.data';
import {
  HealthcareActorRoles,
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from '../../shared/healthcare-constants';


/**
 * @file This file serves as the Single Source of Truth for all complex test payloads
 * and examples used across integration tests, cURL documentation, and Swagger specs.
 * It is designed to be a 1:1 representation of the payloads described in the
 * `docs/API_INTEGRATORS_GUIDE.md`, while also retaining other payloads used in tests.
 */

// --- Reusable Constants ---

const pdfEmbeddedData = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKMTAwIDEwMCBUZAooSGVsbG8gUERGKSBUagoKRVQKZW5kc3RyZWFtCmVuZGiago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNTMgMDAwMDAgbiAKMDAwMDAwMDEwNiAwMDAwMCBuIAowMDAwMDAwMjU1IDAwMDAwIG4gCjAwMDAwMDAzNDMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDMKJSVFT0Y=";

const deviceKidMldsa = "thumbprint-public-sig-key-device";
// Canonical JWK thumbprint material (RFC 7638): do NOT include `kid` or `use`.
const deviceJwkMldsaThumbprint = {
  "alg": "ML-DSA-44",
  "kty": "AKP",
  "pub": "base64url-public-sig-key-device",
} as const;
// Full JWK as it appears in JWKS (kid/use are fine here for routing/selection).
const deviceJwkMldsa = {
  ...deviceJwkMldsaThumbprint,
  "kid": deviceKidMldsa,
  "use": "sig",
} as const;

const deviceKidMlkem = "thumbprint-public-enc-key-device";
// Recipient encryption key id (resolved from the destination DID Document / JWKS).
const recipientKidMlkem = "thumbprint-public-enc-key-recipient";
// Canonical JWK thumbprint material (RFC 7638): do NOT include `kid` or `use`.
const deviceJwkMlkemThumbprint = {
  "crv": "ML-KEM-768",
  "kty": "OKP",
  "x": "base64url-public-enc-key-device",
} as const;
// Full JWK as it appears in JWKS (kid/use are fine here for routing/selection).
const deviceJwkMlkem = {
  ...deviceJwkMlkemThumbprint,
  "kid": deviceKidMlkem,
  "use": "enc",
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
      "typ": "application/didcomm-encrypted+json",
      // Nested JOSE: JWE wraps a compact JWS payload.
      "cty": "JWS",
      "enc": "A256GCM",
      "alg": "ML-KEM-768",
      // Recipient (target) key id.
      "kid": recipientKidMlkem,
      // Sender key id.
      "skid": deviceKidMlkem,
      // Bootstrap: provide the sender's public encryption key (without `kid`/`use`).
      "jwk": { ...deviceJwkMlkemThumbprint },
    }
  },    
  "jws": {
    "protected": {
      "typ": "application/didcomm-signed+json",
      // The JWS payload is a DIDComm plaintext JSON object.
      "cty": "application/didcomm-plaintext+json",
      "alg": deviceJwkMldsa.alg,
      "kid": deviceKidMldsa,
      // Bootstrap: provide the sender's public signing key (without `kid`/`use`).
      "jwk": { ...deviceJwkMldsaThumbprint },
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
      "typ": "application/didcomm-encrypted+json",
      "cty": "JWS",
      "enc": "A256GCM",
      "alg": "ML-KEM-768",
      "kid": recipientKidMlkem,
      "skid": deviceKidMlkem,
    }
  },    
  "jws": {
    "protected": {
      "typ": "application/didcomm-signed+json",
      "cty": "application/didcomm-plaintext+json",
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
  "jti": "org-registration-request-<test-id>",
  "thid": "org-registration-thread-<test-id>",
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
          ...((({ "org.schema.Organization.alternateName": _alternateName, ...legalClaims }) => legalClaims)(testClaimsRegisterTenantExpanded)),
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
  "jti": "org-registration-response-<test-id>",
  "thid": "org-registration-thread-<test-id>",
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
 * Use the Offer identifier returned by the Organization registration _batch-response.
 */
export const ORGANIZATION_ORDER_REQUEST = {
  "jti": "org-order-request-<test-id>",
  "thid": "org-order-thread-<test-id>",
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
          "Order.acceptedOffer.identifier": "{{offerId}}",
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Response to a successful order request, containing the payment communication bundle.
 */
export const ORGANIZATION_ORDER_RESPONSE = {
  "jti": "org-order-response-<test-id>",
  "thid": "org-order-thread-<test-id>",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "resourceType": "Bundle",
    "type": "batch-response",
    "total": 1,
    "data": [
      {
        "type": "Organization-order-response-v1.0",
        "meta": {
          "claims": {
            "@context": "org.schema",
            "@type": "Order:Invoice",
            "org.schema.Order.acceptedOffer.identifier": "urn:cds:ES:v1:health-care:product:org.schema:Offer:<offer-uuid>",
            "org.schema.Order.partOfInvoice": "<invoice-id-or-url>",
            "org.schema.Order.paymentMethod": "Stripe",
            "org.schema.Order.paymentDueDate": "2025-10-22T14:30:00Z",
            "org.schema.Order.paymentUrl": "<payment-url>",
            "org.schema.Order.invoiceIssuedAt": "2025-10-15T14:30:00Z",
            "org.schema.IndividualProduct.serialNumber": "lic-activation-code-001",
            "org.schema.IndividualProduct.category": "professional"
          }
        },
        "response": { "status": "201" }
      }
    ]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Canonical ICA-first activation request.
 *
 * Contract priority:
 * - `vp_token` is the canonical proof carrier and should embed the ICA evidence
 * - the VP inside `vp_token` is assembled from the ICA-issued organization VC,
 *   ICA-issued legal-representative VC, presenter signing key id, and target
 *   host operator id before external signing
 * - `org.schema.Service.url` is the hosting URL selected by the controller
 *   during onboarding; it points to the chosen hosting operator/connector
 *   location and must not be confused with the tenant public `did:web`
 * - `controller.*` is explicit public key binding material for controller/person DID bootstrap
 * - `organizationCredential` / `representativeCredential` are deprecated compatibility fields
 */
export const ORGANIZATION_ACTIVATION_REQUEST = {
  "jti": "org-activation-request-<test-id>",
  "thid": "org-activation-thread-<test-id>",
  "iss": "urn:ietf:params:oauth:jwk-thumbprint:sha-256:<controller-signing-thumbprint>",
  "aud": "host:node-operator-es",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "vp_token": "<ica-proof-token>",
    "controller": {
      "did": "did:web:people.acme.org:controllers:primary",
      "sameAs": "mailto:controller@acme.org",
      "publicKeyJwk": {
        "kid": "controller-es384-001",
        "kty": "EC",
        "crv": "P-384",
        "x": "<x>",
        "y": "<y>",
        "alg": "ES384",
        "use": "sig"
      },
      "jwks": {
        "keys": [
          {
            "kid": "controller-didcomm-enc-001",
            "kty": "EC",
            "crv": "P-384",
            "x": "<enc-x>",
            "y": "<enc-y>",
            "use": "enc",
            "purposes": ["didcomm-enc"]
          }
        ]
      }
    },
    "organizationCredential": "<deprecated-legacy-compat>",
    "representativeCredential": "<deprecated-legacy-compat>",
    "data": [{
      "type": "Organization-activation-request-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "@type": "template",
          ...testClaimsRegisterTenantExpanded,
          "org.schema.Service.url": "https://connector.example.net/acme/cds-es/v1/health-care",
          "org.schema.Service.serviceType": "indexing.cruds,indexing.rs,digitaltwin.rs",
          "org.schema.Service.termsOfService": pdfEmbeddedData
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyFullJWK }
};

// --- Async Polling (HTTP-level payloads) ---

export const ASYNC_POLL_REQUEST = {
  "thid": "action-thread-<test-id>",
};

export const ASYNC_POLL_PENDING_RESPONSE = {
  "thid": "action-thread-<test-id>",
  "status": "PENDING",
};

export const ORGANIZATION_REGISTRATION_POLL_REQUEST = {
  "thid": "org-registration-thread-<test-id>",
};

export const ORGANIZATION_ORDER_POLL_REQUEST = {
  "thid": "org-order-thread-<test-id>",
};

export const EMPLOYEE_POLL_REQUEST = {
  "thid": "employee-thread-<test-id>",
};

export const CONSENT_POLL_REQUEST = {
  "thid": "consent-thread-<test-id>",
};

export const COMMUNICATION_POLL_REQUEST = {
  "thid": "communication-thread-<test-id>",
};

export const COMPOSITION_POLL_REQUEST = {
  "thid": "composition-thread-<test-id>",
};

export const RELATED_PERSON_POLL_REQUEST = {
  "thid": "relatedperson-thread-<test-id>",
};

export const OBSERVATION_POLL_REQUEST = {
  "thid": "observation-thread-<test-id>",
};

export const TOKEN_EXCHANGE_POLL_REQUEST = {
  "thid": "token-exchange-thread-<test-id>",
};

export const TENANT_ORGANIZATION_POLL_REQUEST = {
  "thid": "tenant-organization-thread-<test-id>",
};

export const TENANT_ORDER_POLL_REQUEST = {
  "thid": "tenant-order-thread-<test-id>",
};

// For legacy/plaintext submissions, the polling endpoint returns the decoded business `body` only.
export const ORGANIZATION_REGISTRATION_POLL_RESULT_BODY = ORGANIZATION_REGISTRATION_RESPONSE.body;
export const ORGANIZATION_ORDER_POLL_RESULT_BODY = ORGANIZATION_ORDER_RESPONSE.body;

// For secure submissions, the polling endpoint returns a form-encoded `response=<jwe>`.
export const ASYNC_POLL_SECURE_RESPONSE_FORM = {
  response: 'eyJ...<jwe>',
};


// --- 2. Device and Identity Registration ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The inner body of a Device Registration (DCR) request.
 */
export const DCR_REQUEST_BODY = {
  "application_type": "web",
  "client_name": "App for [email] as [role] on [iOS, Android, Web]",
  "code": "00000000-0000-0000-0000-000000000000",
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
  "jti": "device-registration-request-<test-id>",
  "thid": "device-registration-thread-<test-id>",
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
  "jti": "device-registration-response-<test-id>",
  "thid": "device-registration-thread-<test-id>",
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
  "jti": "smart-token-request-<test-id>",
  "thid": "smart-token-thread-<test-id>",
  "iss": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "client_id": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
    "redirect_uri": "https://app.acme.org/callback",
    "code_challenge": "b2MtY2hhbGxlbmdlLWJhc2U2NA",
    "code_challenge_method": "S256",
    "acr_values": "urn:antifraud:acr:openid4vp:employee",
    "vp_token": "<vp-jws-or-jsonld>",
    "presentation_submission": {
      "id": "ps-001",
      "definition_id": "pd-001",
      "descriptor_map": [
        {
          "id": "vp-credential",
          "format": "jwt_vp",
          "path": "$.vp_token"
        }
      ]
    },
    "expires_in": 300,
    "token_type": "Bearer",
    "sub": "did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211",
    "purpose": HealthcareConsentPurposes.Treatment,
    "scope": `patient/Composition.rs?subject={{individualDid}}&section=${HealthcareConsentActions.AllergiesAndIntolerances} patient/Consent.cruds`
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.2
 * Exchange activation code + Firebase id_token for initial_access_token (DCR).
 *
 * Note: Authorization header carries the Firebase id_token; body carries `subject_token`.
 */
export const INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST = {
  "jti": "token-exchange-request-<test-id>",
  "thid": "token-exchange-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:api.acme.org#identity_openid_token_exchange",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "subject_token": "{{activationCode}}"
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.1 (tenant admin step)
 * Issue (reserve) a single employee activation code from the tenant license pool.
 *
 * Notes:
 * - This is a tenant-admin / IT operation (not done by the employee device).
 * - The response will return a `batch-response` entry with `id = <activationCode>` for copy/paste.
 */
export const LICENSE_ISSUE_REQUEST = {
  jti: 'license-issue-request-<test-id>',
  thid: 'license-issue-thread-<test-id>',
  iss: 'did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>',
  aud: 'did:web:api.acme.org#identity_openid_license_issue',
  type: 'application/api+json',
  body: {
    resourceType: 'Bundle',
    type: 'batch',
    data: [
      {
        type: 'EmployeeLicenseInvitation-v1.0',
        meta: {
          claims: {
            '@context': 'org.schema',
            '@type': 'IndividualProduct:Issue',
            'org.schema.Person.email': 'doctor1@acme.org',
            'org.schema.Person.hasOccupation.identifier.value': 'ISCO-08|2211',
            'org.schema.IndividualProduct.category': 'professional',
            'org.schema.IndividualProduct.additionalType': 'mobile',
          },
        },
        request: { method: 'POST', url: '/acme/cds-ES/v1/health-care/identity/openid/License/_issue' },
      },
    ],
  },
} as const;

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.1
 * Issue an activation code for an employee that already exists in the tenant.
 */
export const LICENSE_ISSUE_EXISTING_EMPLOYEE_REQUEST = {
  ...LICENSE_ISSUE_REQUEST,
  thid: 'license-issue-thread-<test-id>-existing-employee',
  jti: 'license-issue-request-<test-id>-existing-employee',
  body: {
    ...LICENSE_ISSUE_REQUEST.body,
    data: [
      {
        ...LICENSE_ISSUE_REQUEST.body.data[0],
        meta: {
          claims: {
            '@context': 'org.schema',
            '@type': 'IndividualProduct:Issue',
            'org.schema.Person.email': 'admin1@acme.org',
            'org.schema.Person.hasOccupation.identifier.value': 'ISCO-08|1120',
            'org.schema.IndividualProduct.category': 'professional',
            'org.schema.IndividualProduct.additionalType': 'mobile',
          },
        },
      },
    ],
  },
} as const;

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.1
 * Federate external OIDC id_token into Firebase custom token.
 */
export const FIREBASE_CUSTOM_TOKEN_REQUEST = {
  "jti": "firebase-custom-token-request-<test-id>",
  "thid": "firebase-custom-token-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:api.acme.org#identity_firebase_token_custom",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "provider": "eidas",
    "id_token": "<external-oidc-id-token>"
  }
};


// --- 3. End-to-End Business Flows ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.1
 * Request to create a new employee role.
 */
export const EMPLOYEE_REGISTRATION_REQUEST = {
  "jti": "employeerole-registration-request-<test-id>",
  "thid": "employeerole-registration-thread-<test-id>",
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
          "org.schema.Person.hasOccupation.identifier.value": "ISCO-08|4226",
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
  "jti": "family-registration-request-<test-id>",
  "thid": "family-registration-thread-<test-id>",
  "iss": "adult1@example.com",
  "aud": "did:web:api.acme.org",
  "type": "application/api+json",
  "attachments": [{
    "id": "signed-individual-form-pdf",
    "media_type": "application/pdf",
    "data": {
      "links": ["{{signedIndividualFormPdfUrl}}"]
    }
  }],
  "body": {
    "data": [{
      "type": "Family-registration-form-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "@type": "template",
          ...testFamilyRegisterExpanded,
          "Service.termsOfService": "https://provider.example.com/terms.pdf",
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyFullJWK }
};

export const FAMILY_REGISTRATION_REQUEST_INLINE_BASE64 = {
  ...FAMILY_REGISTRATION_REQUEST,
  attachments: [{
    id: 'signed-individual-form-pdf',
    media_type: 'application/pdf',
    data: {
      base64: '{{signedIndividualFormPdfBase64}}',
    },
  }],
};

/**
 * Canonical successor of `FAMILY_REGISTRATION_REQUEST`.
 *
 * The transport payload is the same; the only difference is the route action:
 * `.../Organization/_transaction` instead of `.../Organization/_batch`.
 */
export const FAMILY_REGISTRATION_TRANSACTION_REQUEST = {
  ...FAMILY_REGISTRATION_REQUEST,
  jti: 'family-registration-transaction-request-<test-id>',
  thid: 'family-registration-transaction-thread-<test-id>',
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.2.1
 * Request to confirm the family registration via an Order.
 * Use the Offer identifier returned by the Family registration _batch-response.
 */
export const FAMILY_ORDER_REQUEST = {
  "jti": "family-order-request-<test-id>",
  "thid": "family-order-thread-<test-id>",
  "iss": "adult1@example.com",
  "aud": "did:web:api.acme.org",
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Family-order-request-v1.0",
      "meta": {
        "claims": {
          "@context": "org.schema",
          "Order.acceptedOffer.identifier": "{{offerId}}"
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};


// --- Other Payloads (Retained for existing tests) ---

export const CUSTOMER_ONBOARDING_MESSAGE = {
  jti: "unique-customer-onboard-message-<test-id>",
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
  jti: "unique-consent-fhir-message-<test-id>",
  thid: "thread-consent-fhir-batch-<test-id>",
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
          "Consent.subject": "{{individualDid}}",
          "Consent.identifier": "urn:uuid:patient-consent-uuid",
          "Consent.grantee": "{{physicianOrg}}",
          "Consent.date": "2025-11-25",
          "Consent.purpose": HealthcareConsentPurposes.Treatment,
          "Consent.action": HealthcareConsentActions.AllergiesAndIntolerances,
          "Consent.actor-identifier": "{{physicianDid}}",
          "Consent.actor-role": HealthcareActorRoles.Physician,
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
            code: HealthcareConsentPurposes.Treatment
          }]
        }],
        patient: { reference: "{{individualDid}}" },
        performer: [{ reference: "{{physicianDid}}" }],
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
  jti: "unique-communication-message-<test-id>",
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
          "Communication.category": "http://terminology.hl7.org/CodeSystem/communication-category|reminder",
          "Communication.content-attachment-data": "QkVHSU4...5EQVI=",
          "Communication.content-attachment-title": "appointment-details.ics",
          "Communication.content-attachment-type": "text/calendar",
          "Communication.content-reference": "https://url-to-appointment-source.com/some-uuid",
          "Communication.part-of": "urn:uuid:communication-channel-id",
          "Communication.recipient": "{{individualDid}}",
          "Communication.sender": "{{physicianDid}}",
          "Communication.sent": "2025-10-15T14:30:00Z",
          "Communication.subject": "{{individualDid}}",
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
            code: "reminder",
            system: "http://terminology.hl7.org/CodeSystem/communication-category"
          }]
        }],
        recipient: [{ reference: "{{individualDid}}" }],
        sender: { reference: "{{physicianDid}}" },
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

/**
 * @see API_INTEGRATORS_GUIDE.md section 9
 * Update the Unified Health Index (FHIR Composition) with a single entry.
 */
export const COMPOSITION_UPDATE_MESSAGE = {
  "jti": "composition-update-request-<test-id>",
  "thid": "composition-update-thread-<test-id>",
  "iss": "{{physicianDid}}",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "org.hl7.fhir.r4.Bundle",
  "body": {
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [{
      "type": "Composition",
      "meta": {
        "claims": {
          "@context": "org.hl7.fhir.api",
          "@type": "Composition:IndexEntry",
          "Composition.subject": "{{individualDid}}",
          "Composition.section": "LOINC|48765-2",
          "Composition.entry": "https://ehr.hospital.example.com/fhir/AllergyIntolerance/12345,https://ehr.hospital.example.com/fhir/DiagnosticReport/67890",
          "Composition.date": "2025-11-26T10:00:00Z",
          "Composition.author": "{{physicianDid}}",
          "Composition.title": "Allergies and Intolerances: hospital.example.com (2025-11-26T10:00:00Z)",
          "Composition.type": "LOINC|60591-5"
        }
      },
      "request": {
        "method": "POST",
        "url": "individual/org.hl7.fhir.r4/Composition"
      },
      "resource": {
        "resourceType": "Composition",
        "status": "final",
        "subject": { "reference": "{{individualDid}}" },
        "date": "2025-11-26T10:00:00Z",
        "author": [{ "reference": "{{physicianDid}}" }],
        "title": "Allergies and Intolerances: hospital.example.com (2025-11-26T10:00:00Z)",
        "type": { "coding": [{ "system": "http://loinc.org", "code": "60591-5" }] },
        "section": [{
          "title": "Allergies and Intolerances",
          "code": { "coding": [{ "system": "http://loinc.org", "code": "48765-2" }] },
          "entry": [
            { "reference": "https://ehr.hospital.example.com/fhir/AllergyIntolerance/12345" },
            { "reference": "https://ehr.hospital.example.com/fhir/DiagnosticReport/67890" }
          ]
        }]
      }
    }]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 9.A
 * Research ingestion (digital twin) using claims-first Composition resources,
 * typically generated by adapter-ingestion-py from vendor exports (e.g., Qvet/Wakyma).
 *
 * Notes:
 * - This payload intentionally uses `body.data[]` (JSON:API primary document style).
 * - `resource.meta.claims` contains Composition flat claims.
 * - `resource.contained[].meta.claims` can carry source-level claims (DocumentReference, etc.).
 * - Current gateway manager persists only Composition-level claims for indexing.
 */
export const RESEARCH_COMPOSITION_INGESTION_MESSAGE = {
  jti: 'research-composition-request-<test-id>',
  thid: 'research-composition-thread-<test-id>',
  iss: 'did:web:clinic.example.com:employee:data-loader',
  aud: 'did:web:api.acme.org',
  type: 'application/api+json', // instead of 'org.hl7.fhir.api.Bundle' as "data" property is used (JSON:API Primary Document) but not "entry"
  body: {
    resourceType: 'Bundle',
    type: 'batch',
    data: [
      {
        type: 'Composition',
        resource: {
          resourceType: 'Composition',
          id: 'urn:uuid:0dbe2f39-3f6a-48a3-9807-2f9a102f1a11',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.api',
              '@type': 'Composition:ResearchDigitalTwin',
              'Composition.subject': 'did:web:connector.example.com:animal:multihash:z3vYh7w9q2p1k4m8n6a5b4c3d2e1f0',
              'Composition.section': 'LOINC|26436-6',
              'Composition.type': 'LOINC|60591-5',
              'Composition.date': '2026-01-31T10:45:00Z',
              'Composition.author': '',
              'Composition.entry': 'urn:uuid:c2b1f9ee-90d4-4f1d-8dc6-4c3f0b29621b,urn:uuid:aad1f0bc-5781-42dc-9d8f-30252fbce6a9',
            },
          },
          contained: [
            {
              resourceType: 'DocumentReference',
              id: 'urn:uuid:c2b1f9ee-90d4-4f1d-8dc6-4c3f0b29621b',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'DocumentReference:Lab',
                  'DocumentReference.subject': 'did:web:connector.example.com:animal:multihash:z3vYh7w9q2p1k4m8n6a5b4c3d2e1f0',
                  'DocumentReference.identifier': 'urn:uuid:c2b1f9ee-90d4-4f1d-8dc6-4c3f0b29621b',
                  'DocumentReference.type': 'http://loinc.org|26436-6',
                  'DocumentReference.category': 'http://loinc.org|26436-6',
                  'DocumentReference.status': 'current',
                  'DocumentReference.date': '2026-01-15T09:00:00Z',
                  'DocumentReference.description': 'Laboratorio propio',
                },
              },
            },
            {
              resourceType: 'DocumentReference',
              id: 'urn:uuid:aad1f0bc-5781-42dc-9d8f-30252fbce6a9',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'DocumentReference:Imaging',
                  'DocumentReference.subject': 'did:web:connector.example.com:animal:multihash:z3vYh7w9q2p1k4m8n6a5b4c3d2e1f0',
                  'DocumentReference.identifier': 'urn:uuid:aad1f0bc-5781-42dc-9d8f-30252fbce6a9',
                  'DocumentReference.type': 'http://loinc.org|18748-4',
                  'DocumentReference.category': 'http://loinc.org|18726-0',
                  'DocumentReference.status': 'current',
                  'DocumentReference.date': '2026-01-16T12:30:00Z',
                  'DocumentReference.description': 'Diagnostico por imagen propio',
                },
              },
            },
          ],
        },
        request: {
          method: 'POST',
          url: 'digitaltwin/org.hl7.fhir.api/Composition',
        },
      },
    ],
  },
};

// --- 8. Personal Observations (non-clinical) ---

export const PERSONAL_OBSERVATION_MESSAGE = {
  jti: "personal-observation-message-<test-id>",
  thid: "thid-personal-observation",
  iss: "{{individualDid}}:device:<uuid>",
  aud: "did:web:api.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      type: "Observation",
      meta: {
        claims: {
          "@context": "org.hl7.fhir.api",
          "@type": "Observation:SelfReported",
          "Observation.subject": "{{individualDid}}",
          "Observation.category": "http://terminology.hl7.org/CodeSystem/observation-category|social-history",
          // User-selected code (e.g., from a picker based on a curated SNOMED IPS ValueSet).
          // NOTE:
          // - Keep observations atomic: one concept per Observation.
          // - SNOMED codes MUST be concept IDs (not description IDs). In the IPS release file, the "conceptId" is the code.
          "Observation.code": "SNOMED|48694002",
          "Observation.code-userselected": true,
          // FHIR: `issued` = when the Observation was created/recorded.
          // `effective[x]` = when the finding applies (e.g., NIGHT for recurring symptoms).
          "Observation.issued": "2025-11-27T10:00:00Z",
          // Flat claims follow the FHIR SearchParameter "date" concept (effective[x]) and custom extensions.
          // Canonical internal mapping can convert this to `effectiveTiming.repeat.when`.
          "Observation.date-when": "NIGHT",
          // Free text details (optional). If you want to capture "music preferences", emit separate Observations.
          // FHIR search-param style value key:
          "Observation.value-string": "Feels anxious at night.",
          // Optional short English tags for grouping/routing (comma-separated).
          "Observation.meta-tag": "Anxiety,Night",
        }
      },
      request: { method: "POST", url: "individual/org.hl7.fhir.api/Observation" },
      resource: { resourceType: "Observation", status: "final" }
    }]
  }
};

export const PERSONAL_PREFERENCES_MDS_MESSAGE = {
  jti: "personal-preferences-mds-message-<test-id>",
  thid: "thid-personal-preferences-mds",
  iss: "{{individualDid}}:device:<uuid>",
  aud: "did:web:api.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [
      {
        type: "Observation",
        meta: {
          claims: {
            "@context": "org.hl7.fhir.api",
            "@type": "Observation:SelfReported",
            "Observation.subject": "{{individualDid}}",
            "Observation.category": "http://terminology.hl7.org/CodeSystem/observation-category|social-history",
            "Observation.code": "LOINC|54728-1",
            "Observation.code-userselected": true,
            "Observation.issued": "2025-11-27T10:05:00Z",
            "Observation.value-concept": "http://terminology.hl7.org/CodeSystem/v2-0136|Y",
          }
        },
        request: { method: "POST", url: "individual/org.hl7.fhir.api/Observation" },
        resource: { resourceType: "Observation", status: "final" }
      },
      {
        type: "Observation",
        meta: {
          claims: {
            "@context": "org.hl7.fhir.api",
            "@type": "Observation:SelfReported",
            "Observation.subject": "{{individualDid}}",
            "Observation.category": "http://terminology.hl7.org/CodeSystem/observation-category|social-history",
            "Observation.code": "LOINC|54723-2",
            "Observation.code-userselected": true,
            "Observation.issued": "2025-11-27T10:05:05Z",
            "Observation.value-concept": "http://terminology.hl7.org/CodeSystem/v2-0136|Y",
          }
        },
        request: { method: "POST", url: "individual/org.hl7.fhir.api/Observation" },
        resource: { resourceType: "Observation", status: "final" }
      }
    ]
  }
};

export const FAMILY_MEMBER_RELATIONSHIP_MESSAGE = {
  jti: "family-relationship-message-<test-id>",
  thid: "thid-family-relationship",
  iss: "{{individualControllerDid}}:device:<uuid>",
  aud: "did:web:api.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      type: "RelatedPerson",
      meta: {
        claims: {
          "@context": "org.hl7.fhir.api",
          "@type": "RelatedPerson:EmergencyContact",
          "RelatedPerson.patient": "{{individualDid}}",
          "RelatedPerson.identifier": "urn:uuid:related-person-uuid",
          "RelatedPerson.relationship": "http://terminology.hl7.org/CodeSystem/v3-RoleCode|PRN",
          "RelatedPerson.telecom": "tel:+34600123456",
          "RelatedPerson.name": "Jane Doe",
        }
      },
      request: { method: "POST", url: "individual/org.hl7.fhir.api/RelatedPerson" },
      resource: { resourceType: "RelatedPerson" }
    }]
  }
};
