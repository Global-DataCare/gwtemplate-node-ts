// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__test__/data/organization.data.ts

import { ClaimsRecord } from "../../models/resource-document";
import { ClaimsOrgSchemaorg, ClaimsServiceSchemaorg } from "../../models/schemaorg";
import {
    testHostAdmin1,
    testTenant1Admin1,
    testTenant1Receptionist1,
    testTenant1Firefighter1,
    testTenant1Nurse1,
    testClaimsHostAdmin1,
    testClaimsEmployeeAdminTenant1
} from "./employee.data";
import { testHostBaseData, testTenant1BaseData } from "./organization.data";


// ===================================================================================
// GROUPED & EXPORTED TEST DATA OBJECTS
// ===================================================================================

/**
 * A comprehensive, structured object containing all data for the HOST organization.
 * It assembles the base data with its administrative member.
 */
export const testHostData = {
    ...testHostBaseData,
    member: {
        admin1: testHostAdmin1,
    },
};

/**
 * A comprehensive, structured object containing all data for TENANT 1.
 * It assembles the base data with all its relevant members.
 */
export const testTenant1Data = {
    ...testTenant1BaseData,
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
    [ClaimsOrgSchemaorg.legalName]: testHostData.legalName,
    [ClaimsOrgSchemaorg.identifier]: testHostData.identifier,
    [ClaimsOrgSchemaorg.alternateName]: testHostData.alternateName,
    [ClaimsOrgSchemaorg.addressCountry]: testHostData.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testHostData.taxId,
};

/**
 * Valid claims for the 'host' organization's initial setup, including its admin and provider service.
 */
export const testClaimsHostInitialization = {
    ...testClaimsHostOrganization,
    ...testClaimsHostAdmin1,
    [ClaimsServiceSchemaorg.category]: testHostData.provider.service.category,
    [ClaimsServiceSchemaorg.identifier]: testHostData.provider.service.identifier,
    [ClaimsServiceSchemaorg.serviceType]: testHostData.provider.service.serviceTypePurpose,
    [ClaimsServiceSchemaorg.termsOfService]: testHostData.provider.service.termsOfService,
};


/**
 * Well-formed claims for a tenant organization registration.
 */
export const testClaimsTenant1Organization = {
    ...baseClaims,
    // [ClaimsOrgSchemaorg.url]: testTenant1Data.url,
    [ClaimsOrgSchemaorg.legalName]: testTenant1Data.legalName,
    [ClaimsOrgSchemaorg.identifier]: testTenant1Data.identifier,
    [ClaimsOrgSchemaorg.alternateName]: testTenant1Data.alternateName,
    [ClaimsOrgSchemaorg.addressCountry]: testTenant1Data.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testTenant1Data.taxId,
};

/**
 * Valid claims for a new tenant registration, including its admin and provider service.
 */
export const testClaimsTenant1Registration = {
    ...testClaimsTenant1Organization,
    ...testClaimsEmployeeAdminTenant1,
    [ClaimsServiceSchemaorg.category]: testTenant1Data.provider.service.category,
    [ClaimsServiceSchemaorg.identifier]: testTenant1Data.provider.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testTenant1Data.provider.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testTenant1Data.provider.service.serviceTypePurpose,
};

/**
 * A full, well-formed input payload for a tenant registration, matching the structure expected by the API.
 */
export const testPayloadCreateTenant1 = {
  thid: `thid-${testTenant1Data.uuid}`,
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
    [ClaimsOrgSchemaorg.alternateName]: 'hosting-tenant-1',
};
