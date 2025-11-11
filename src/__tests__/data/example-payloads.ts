// src/__tests__/data/example-payloads.ts

/**
 * This file serves as the Single Source of Truth for all complex test payloads
 * and examples used across integration tests, cURL documentation, and Swagger specs.
 */

const pdfEmbeddedData = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKMTAwIDEwMCBUZAooSGVsbG8gUERGKSBUagoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNTMgMDAwMDAgbiAKMDAwMDAwMDEwNiAwMDAwMCBuIAowMDAwMDAwMjU1IDAwMDAwIG4gCjAwMDAwMDAzNDMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDMKJSVFT0Y=";

export const ORGANIZATION_REGISTRATION_PAYLOAD = {
  thid: "thid-org-c1c2c3d4-e5f6-7890-1234-567890abcdef",
  iss: "admin1@acme.org",
  aud: "did:web:host.example.com",
  body: {
    data: [
      {
        type: "Organization-registration-form-v1.0",
        meta: {
          claims: {
            "@context": "org.schema",
            "@type": "template",
            "org.schema.Organization.legalName": "Acme Organization",
            "org.schema.Organization.identifier.additionalType": "TAX",
            "org.schema.Organization.identifier.value": "A123456789",
            "org.schema.Organization.alternateName": "acme",
            "org.schema.Organization.address.addressCountry": "ES",
            "org.schema.Person.identifier": "urn:uuid:b1b2c3d4-e5f6-7890-1234-567890abcdef",
            "org.schema.Person.hasOccupation": "ISCO-08:1120",
            "org.schema.Person.email": "admin1@acme.org",
            "org.schema.Service.category": "health-care",
            "org.schema.Service.identifier": "did:web:api-provider.example.com",
            "org.schema.Service.termsOfService": pdfEmbeddedData,
            "org.schema.Service.serviceType": "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC",
          },
        },
      },
    ],
  },
};

export const EMPLOYEE_REGISTRATION_PAYLOAD = {
  thid: "thid-employee-11b2c3d4-e5f6-7890-1234-567890abcdef",
  iss: "did:web:acme.org:employee:...",
  aud: "did:web:acme.org",
  body: {
    data: [
      {
        type: "Employee-form-v1.0",
        request: { method: "POST", url: "entity/org.schema/Employee/" },
        meta: {
          claims: {
            "org.schema.Person.identifier": "urn:uuid:11b2c3d4-e5f6-7890-1234-567890abcdef",
            "org.schema.Person.hasOccupation": "ISCO-08:4226",
            "org.schema.Person.email": "receptionist1@acme.org",
          },
        },
      },
    ],
  },
};

export const CUSTOMER_ONBOARDING_PAYLOAD = {
  thid: "thid-e2e-onboarding-customer-12345",
  iss: "did:web:acme.org:employee:...",
  aud: "did:web:acme.org",
  body: {
    data: [
      {
        type: "Individual-terms-v1.0",
        request: { method: "POST", url: "individual/org.schema/Person/" },
        meta: {
          claims: {
            "org.schema.Person.alternateName": "Joe",
            "org.schema.Person.identifier": "urn:uuid:8e0d846a-2492-4b9c-8a4e-5e065fb6ba76",
            "org.schema.Person.email": "customer1@example.com",
            "org.schema.Service.category": "health-care",
            "org.schema.Service.termsOfService": "https://provider.example.com/terms",
            "org.schema.Service.serviceType": "http://terminology.hl7.org/CodeSystem/v3-ActReason|FAMRQT,PWATRNY,METAMGT,FRAUD,RECORDMGT,COVAUTH,TREAT,DISASTER,HPAYMT,MLTRAINING,ETREAT,HOPERAT,CAREMGT,HSYSADMIN,PATADMIN,PATSFTY",
          },
        },
      },
      {
        type: "Personal-identity-v1.0",
        request: { method: "POST", url: "individual/org.schema/Person/" },
        meta: {
          claims: {
            "org.schema.Person.identifier": "urn:uuid:8e0d846a-2492-4b9c-8a4e-5e065fb6ba76",
            "org.schema.Person.identifierType": "NNES",
            "org.schema.Person.identifierValue": "12345678X",
          },
        },
      },
    ],
  },
};

export const CONSENT_PAYLOAD = {
  thid: "thid-consent-dynamic",
  iss: "did:web:acme.org:employee:...",
  aud: "did:web:acme.org",
  body: {
    resourceType: "Consent",
    id: "urn:uuid:channel-12345",
    status: "active",
    scope: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentscope", code: "patient-privacy" }] },
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/consentcategorycodes", code: "comm" }] }],
    patient: { reference: "urn:uuid:{CUSTOMER_URN_UUID}" },
    performer: [{ reference: "urn:uuid:{ORGANIZATION_URN_UUID}" }],
    sourceAttachment: {
      contentType: "application/odrl+json",
      data: "eyAiQGNvbnRleHQiOiAiaHR0cDovL3d3dy53My5vcmcvbnMvb2RybC5qc29ubGQiLCAiQHR5cGUiOiAiQWdyZWVtZW50IiwgInVpZCI6ICJ1cm46dXVpZDpvZHJsLXBvbGljeS0xMjMiLCAidGFyZ2V0IjogInVybjp1dWlkOntDVVNUT01FUl9VUk5fVVVJRH0iLCAiYXNzaWduZXIiOiAidXJuOnV1aWQ6e0NVU1RPTUVSX1VSTl9VVUlEfSIsICJhc3NpZ25lZSI6ICJ1cm46dXVpZDp7T1JHQU5JWkFUSU9OX1VSTl9VVUlEfSIsICJwZXJtaXNzaW9uIjogW3sgImFjdGlvbiI6ICJyZWFkIiwgInRhcmdldCI6ICJodHRwczovL2Nvbm5lY3RoZWFsdGguY29tL2ZoaXIvQ29tbXVuaWNhdGlvbiIsICJjb25zdHJhaW50IjogW3sgImxlZnRPcGVyYW5kIjogInB1cnBvc2UiLCAib3BlcmF0b3IiOiAiZXEiLCAicmlnaHRPcGVyYW5kIjogIlRSRUFUIiB9XSB9XSB9"
    },
    provision: { type: "permit" }
  }
};

export const COMMUNICATION_PAYLOAD = {
  thid: "thid-comm-dynamic",
  iss: "did:web:acme.org:employee:...",
  aud: "did:web:acme.org",
  body: {
    resourceType: "Communication",
    status: "completed",
    partOf: [{ reference: "urn:uuid:channel-12345" }],
    category: [
      { "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/communication-category", "code": "appointment-reminder" }] }
    ],
    recipient: [ { "reference": "urn:uuid:{CUSTOMER_URN_UUID}" } ],
    sender: { "reference": "urn:uuid:{ORGANIZATION_URN_UUID}" },
    sent: "2025-10-15T14:30:00Z",
    note: [{ "text": "This is your new appointment. Best regards." }],
    payload: [
      { "contentReference": { "reference": "https://url-to-appointment-source.com/some-uuid" } },
      {
        "contentAttachment": {
          "contentType": "text/calendar",
          "data": "QkVHSU46VkNBTEVOREFSCgpWRVJTSU9OOjIuMApQUk9ESUQ6LS8vQWNtZS8vZGlkOndlYjphcGkuYWNtZS5vcmcvL0VTCkJFR0lOOlZFVkVOVApVSUQ6PHV1aWQtdjQ+CkRUU1BTVA6MjAyNTEwMTZUMTIwMDAwWgpEVFNUQVJUOjIwMjUxMDE3VDE1MDAwMFoKRF RFTkQ6MjAyNTEwMTdUMTYwMDAwWgpTVU1NQVJZOlJlc3VtZW4gZGUgY2l0YS4KREVTQ1JJUFRJT046RW5jdWVudHJvIHZpcnR1YWwuCkxPQ0FUSU9OOk9ubGluZQpFTkQ6VkVWRU5UCkVORDpWQ0FMRU5EQVI=",
          "title": "appointment-details.ics"
        }
      }
    ]
  }
};
