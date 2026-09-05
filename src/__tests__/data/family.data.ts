// TDD contract: write this test red first; make it green only with the complete real behavior.

// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
import { testDefaultTenantServiceTypeClaim } from "./organization.data";
import { EXAMPLE_PRIVATE_INDIVIDUAL_UUID } from 'gdc-common-utils-ts/examples/shared';

/** Test Claims for example-payloads */
export const testFamilyRegisterExpanded = {
  "Organization.address.addressCountry": "ES",
  "Organization.identifier.additionalType": "UUID",
  "Organization.identifier.value": EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
  "Organization.owner.email": "adult1@example.com",
  "Organization.owner.identifier.value": "<cert-serialnumber>",
  "Person.email": "child1@example.com",
  "Person.identifier.additionalType": "UUID",
  "Person.identifier.value": "<child1-ID>",
  "Service.category": "health-care",
  "Service.identifier": "did:web:api-provider.example.com",
  "Service.serviceType": testDefaultTenantServiceTypeClaim,
}
