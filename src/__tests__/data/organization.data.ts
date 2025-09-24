// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__test__/data/organization.data.ts

import { ClaimsRecord } from "../../models/resource-document";
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from "../../models/schemaorg";

// ===================================================================================
// COMMON TEST DATA
// ===================================================================================
/** A standard template ID used across tests. */
export const testTemplateId = "OrgRegistrationForm";
/** A standard template version used across tests. */
export const testTemplateVersion = "1.0";
/** A generic invalid UUID string for testing error handling. */
export const tesInvalidUuid = "invalid-uuid";
/** A generic mocked UUID string for predictable test outcomes. */
export const testMockedUuid = 'mocked-uuid-v4';


// ===================================================================================
// HOST ORGANIZATION DATA
// ===================================================================================
// --- Host Organization Details ---
const testHostUuid = "d1d2d3d4-e5f6-7890-1234-567890abcdef";
const testHostIdentifier = `urn:uuid:${testHostUuid}`;
const testHostAlternateName = "host";
const testHostLegalName = "Host Organization";
const testHostAddressCountry = "ES";
const testHostTaxId = "B12345678";

const testHostProviderUuid = "01c2c3d4-e5f6-7890-1234-567890abcdef";
const testHostProviderIdentifier = `urn:uuid:${testHostProviderUuid}`;
const testHostProviderCategory = "<sector>";
const testHostProviderTermsOfService = "https://host.example.com/terms";
const testHostProviderServiceTypePurpose = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC";

// --- Host Admin 1 Details ---
const testHostAdmin1Uuid = "a1b2c3d4-e5f6-7890-1234-567890abcdef";
const testHostAdmin1Identifier = `urn:uuid:${testHostAdmin1Uuid}`;
const testHostAdmin1Email = "host-admin1@example.com";
const testHostAdmin1HasOccupation = "ISCO-08:1120";


// ===================================================================================
// TENANT 1 ORGANIZATION DATA
// ===================================================================================
// --- Tenant 1 Organization Details ---
const testTenant1Uuid = "c1c2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1Identifier = `urn:uuid:${testTenant1Uuid}`;
const testTenant1LegalName = "Tenant One";
const testTenant1AlternateName = "tenant1";
const testTenant1AddressCountry = "FR";
const testTenant1TaxId = "987654321";

// --- Tenant 1 - Service Provider Details ---
const testTenant1ProviderUuid = "d1c2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1ProviderIdentifier = `urn:uuid:${testTenant1ProviderUuid}`;
const testTenant1ProviderCategory = "<sector>";
const testTenant1ProviderTermsOfService = "https://tenant1.example.com/terms";
const testTenant1ProviderServiceTypePurpose = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC";

// --- Tenant 1 - Admin 1 Details ---
const testTenant1Admin1MockedUuid = "tenant1-admin1-id";
const testTenant1Admin1Uuid = "b1b2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1Admin1Identifier = `urn:uuid:${testTenant1Admin1Uuid}`;
const testTenant1Admin1Email = "tenant1-admin1@example.com";
const testTenant1Admin1HasOccupation = "ISCO-08:1120";


// ===================================================================================
// GROUPED & EXPORTED TEST DATA OBJECTS
// ===================================================================================

/**
 * A comprehensive, structured object containing all data for the HOST organization.
 */
export const testHostData = {
    uuid: testHostUuid,
    identifier: testHostIdentifier,
    alternateName: testHostAlternateName,
    legalName: testHostLegalName,
    addressCountry: testHostAddressCountry,
    taxId: testHostTaxId,
    member: {
        admin1: {
            uuid: testHostAdmin1Uuid,
            identifier: testHostAdmin1Identifier,
            email: testHostAdmin1Email,
            hasOccupation: testHostAdmin1HasOccupation,
        }
    },
    provider: {
        service: {
            category: testHostProviderCategory,
            identifier: testHostProviderIdentifier,
            serviceType: testHostProviderServiceTypePurpose,
            termsOfService: testHostProviderTermsOfService,
        },
        /** The service for the concrete DB could be included here... (TODO) */
        db: { category: "MEMORY", serviceType: "DATABASE", url: "http://localhost" }
    },
};

/**
 * A comprehensive, structured object containing all data for TENANT 1.
 * Mirrors the structure of testHostData for consistency.
 */
export const testTenant1Data = {
    uuid: testTenant1Uuid,
    identifier: testTenant1Identifier,
    alternateName: testTenant1AlternateName,
    legalName: testTenant1LegalName,
    addressCountry: testTenant1AddressCountry,
    taxId: testTenant1TaxId,
    member: {
        admin1: {
            uuid: testTenant1Admin1Uuid,
            identifier: testTenant1Admin1Identifier,
            email: testTenant1Admin1Email,
            hasOccupation: testTenant1Admin1HasOccupation,
            mockedUuid: testTenant1Admin1MockedUuid
        }
    },
    provider: {
        service: {
            category: testTenant1ProviderCategory,
            identifier: testTenant1ProviderIdentifier,
            serviceType: testTenant1ProviderServiceTypePurpose,
            termsOfService: testTenant1ProviderTermsOfService,
        },
        db: { category: "memory", serviceType: "DATABASE", url: "http://localhost" }
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
    [ClaimsOrgSchemaorg.addressCountry]: testHostData.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testHostData.taxId,
};

/**
 * Valid claims for the 'host' organization,
 * including the admin registering the organization and the software provider
 */
export const testClaimsHostInitialization = {
    ...testClaimsHostOrganization,
    [ClaimsPersonSchemaorg.identifier]: testHostData.member.admin1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testHostData.member.admin1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testHostData.member.admin1.email,
    [ClaimsServiceSchemaorg.category]: testHostData.provider.service.category,
    [ClaimsServiceSchemaorg.identifier]: testHostData.provider.service.identifier,
    [ClaimsServiceSchemaorg.serviceType]: testHostData.provider.service.serviceType,
    [ClaimsServiceSchemaorg.termsOfService]: testHostData.provider.service.termsOfService,
};


/**
 * Well-formed claims for a tenant registration.
 */
export const testClaimsTenant1Organization = {
    ...baseClaims,
    [ClaimsOrgSchemaorg.legalName]: testTenant1Data.legalName,
    [ClaimsOrgSchemaorg.identifier]: testTenant1Data.identifier,
    [ClaimsOrgSchemaorg.alternateName]: testTenant1Data.alternateName,
    [ClaimsOrgSchemaorg.addressCountry]: testTenant1Data.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testTenant1Data.taxId,
};

/**
 * Valid claims for a tenant, including a service definition.
 */
export const testClaimsTenant1Registration = {
    ...testClaimsTenant1Organization,
    [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Data.member.admin1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Data.member.admin1.email,
    [ClaimsServiceSchemaorg.category]: testTenant1Data.provider.service.category,
    [ClaimsServiceSchemaorg.identifier]: testTenant1Data.provider.service.identifier,
    [ClaimsServiceSchemaorg.termsOfService]: testTenant1Data.provider.service.termsOfService,
    [ClaimsServiceSchemaorg.serviceType]: testTenant1Data.provider.service.serviceType, // purpose
};

/**
 * Claims for a tenant with an invalid alternateName ('host' is not allowed as prefix or suffix for tenants)
 */
export const testClaimsTenant1AlternateNameInvalidPrefix = {
    ...testClaimsTenant1Registration,
    [ClaimsOrgSchemaorg.alternateName]: 'hosting-tenant-1',
};

/**
 * A full, well-formed input payload for a tenant registration,
 * matching the structure expected by the API.
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