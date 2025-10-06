// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__test__/data/organization.data.ts

import { ClaimsRecord } from "../../models/resource-document";
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from "../../models/schemaorg";
import {
    testHostAdmin1,
    testTenant1Admin1,
    testTenant1Receptionist1,
    testTenant1Firefighter1,
    testTenant1Nurse1,
    testClaimsHostAdmin1,
    testClaimsEmployeeAdminTenant1
} from "./employee.data";
import { testConfigDataHost, testConfigTenant1, testTenant1UrnIdentifier } from "./organization.data";
import { testServiceTermsClaimsForHost, testServiceTermsClaimsForTenant1 } from "./service.data";


// ===================================================================================
// GROUPED & EXPORTED TEST DATA OBJECTS
// ===================================================================================

/**
 * A comprehensive, structured object containing all data for the HOST organization.
 * It assembles the base data with its administrative member.
 */
export const testHostData = {
    ...testConfigDataHost,
    member: {
        admin1: testHostAdmin1,
    },
};

/**
 * A comprehensive, structured object containing all data for TENANT 1.
 * It assembles the base data with all its relevant members.
 */
export const testTenant1Data = {
    ...testConfigTenant1,
    identifier: testTenant1UrnIdentifier,
    member: {
        admin1: testTenant1Admin1,
        receptionist1: testTenant1Receptionist1,
        firefighter1: testTenant1Firefighter1,
        nurse1: testTenant1Nurse1,
    },
};


// ===================================================================================
// PRE-BUILT CLAIM SETS FOR TESTS
// ===================================================================================

/** The base set of claims, shared across different claim objects. */
const baseClaims: Omit<ClaimsRecord, "org.schema.Organization.legalName"> = {
    "@context": "org.schema",
    "@type": "template",
};

/** A valid and complete set of claims for registering the HOST organization. */
export const testClaimsHostOrganization: ClaimsRecord = {
    ...baseClaims,
    [ClaimsOrganizationSchemaorg.legalName]: testConfigDataHost.claims[ClaimsOrganizationSchemaorg.legalName],
    [ClaimsOrganizationSchemaorg.identifierType]: testConfigDataHost.claims[ClaimsOrganizationSchemaorg.identifierType],
    [ClaimsOrganizationSchemaorg.identifierValue]: testConfigDataHost.claims[ClaimsOrganizationSchemaorg.identifierValue],
    [ClaimsOrganizationSchemaorg.alternateName]: testConfigDataHost.claims[ClaimsOrganizationSchemaorg.alternateName],
    [ClaimsOrganizationSchemaorg.addressCountry]: testConfigDataHost.claims[ClaimsOrganizationSchemaorg.addressCountry],
};

/**
 * Valid claims for the 'host' organization's initial setup, including its admin and provider service.
 */
export const testClaimsHostInitialization = {
    ...testClaimsHostOrganization,
    ...testClaimsHostAdmin1,
    [ClaimsServiceSchemaorg.category]: testConfigDataHost.provider.service.sectorCategory,
    [ClaimsServiceSchemaorg.identifier]: testConfigDataHost.provider.service.identifier,
    [ClaimsServiceSchemaorg.serviceType]: testConfigDataHost.provider.service.serviceType,
    [ClaimsServiceSchemaorg.termsOfService]: testConfigDataHost.provider.service.termsOfService,
};


/**
 * Well-formed claims for a tenant organization registration.
 */
export const testClaimsTenant1Organization: object = {
    ...baseClaims,
    [ClaimsOrganizationSchemaorg.url]: testConfigTenant1.url,
    [ClaimsOrganizationSchemaorg.legalName]: testConfigTenant1.claims[ClaimsOrganizationSchemaorg.legalName],
    [ClaimsOrganizationSchemaorg.identifierType]: testConfigTenant1.claims[ClaimsOrganizationSchemaorg.identifierType],
    [ClaimsOrganizationSchemaorg.identifierValue]: testConfigTenant1.claims[ClaimsOrganizationSchemaorg.identifierValue],
    [ClaimsOrganizationSchemaorg.alternateName]: testConfigTenant1.claims[ClaimsOrganizationSchemaorg.alternateName],
    [ClaimsOrganizationSchemaorg.addressCountry]: testConfigTenant1.claims[ClaimsOrganizationSchemaorg.addressCountry],
};

/**
 * Valid claims for a new tenant registration, including its admin and provider service.
 */
export const testClaimsTenant1Registration = {
    ...testClaimsTenant1Organization,
    ...testClaimsEmployeeAdminTenant1,
    [ClaimsServiceSchemaorg.category]: testConfigTenant1.provider.service.sectorCategory,
    [ClaimsServiceSchemaorg.identifier]: testConfigTenant1.provider.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testConfigTenant1.provider.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testConfigTenant1.provider.service.serviceTypePurpose,
};

/**
 * A full, well-formed input payload for a tenant registration, matching the structure expected by the API.
 */
export const testPayloadCreateTenant1 = {
  thid: `thid-${testTenant1Data.id}`,
  iss: 'did:web:test-issuer.com',
  aud: 'did:web:host.example.com',
  body: {
    data: [
      {
        type: 'Organization-registration-form-v1.0',
        meta: {
          claims: testClaimsTenant1Registration,
        },
      },
    ],
  },
};

/**
 * Claims for a tenant with an invalid alternateName ('host' is not allowed as prefix or suffix for tenants)
 */
export const testClaimsTenant1AlternateNameInvalidPrefix = {
    ...testClaimsTenant1Registration,
    [ClaimsOrganizationSchemaorg.alternateName]: 'hosting-tenant-1',
};
