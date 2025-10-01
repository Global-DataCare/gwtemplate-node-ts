// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/organization.base.data.ts


/**
 * This file contains the foundational data for test organizations,
 * excluding any member or employee information to prevent circular dependencies.
 */

// ===================================================================================
// COMMON TEST DATA
// ===================================================================================
export const testTemplateId = "OrgRegistrationForm";
export const testTemplateVersion = "1.0";
export const testInvalidUuid = "invalid-uuid";
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
const testTenant1LegalName = "Acme Company";
const testTenant1AlternateName = "acme";
const testTenant1AddressCountry = "US";
const testTenant1TaxId = "98-7654321"; // EIN or TAX ID

// --- Tenant 1 - Service Provider Details ---
const testTenant1ProviderUuid = "d1c2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1ProviderIdentifier = `urn:uuid:${testTenant1ProviderUuid}`;
const testTenant1ProviderCategory = "health-care"; // As requested, using 'health-care' as the sector.
const testTenant1ProviderTermsOfService = "https://provider.example.com/terms";
const testTenant1ProviderServiceTypePurpose = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC";

// --- Tenant 1 - Admin 1 Details ---
const testTenant1Admin1MockedUuid = "acme-admin1-id";
const testTenant1Admin1Uuid = "b1b2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1Admin1Identifier = `urn:uuid:${testTenant1Admin1Uuid}`;
const testTenant1Admin1Email = "admin@acme.example.com";
const testTenant1Admin1HasOccupation = "ISCO-08:1120";


// ===================================================================================
// HOST ORGANIZATION BASE DATA
// ===================================================================================
export const testHostBaseData = {
  uuid: "d1d2d3d4-e5f6-7890-1234-567890abcdef",
  identifier: "urn:uuid:d1d2d3d4-e5f6-7890-1234-567890abcdef",
  alternateName: "host",
  legalName: "Host Organization",
  addressCountry: "ES",
  taxId: "B12345678",
  provider: {
    service: {
      uuid: "01c2c3d4-e5f6-7890-1234-567890abcdef",
      identifier: "urn:uuid:01c2c3d4-e5f6-7890-1234-567890abcdef",
      category: "<sector>",
      termsOfService: "https://host.example.com/terms",
      serviceTypePurpose: "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC",
    },
    db: { category: "MEMORY", serviceType: "DATABASE", url: "http://localhost" },
  },
};

// ===================================================================================
// TENANT 1 ORGANIZATION BASE DATA
// ===================================================================================
export const testTenant1BaseData = {
  uuid: "c1c2c3d4-e5f6-7890-1234-567890abcdef",
  identifier: "urn:uuid:c1c2c3d4-e5f6-7890-1234-567890abcdef",
  legalName: "Acme Company",
  alternateName: "acme",
  addressCountry: "US",
  taxId: "98-7654321",
  url: "https://acme.example.com", //external URL, not provided by the host in this case
  provider: {
    service: {
      uuid: "d1c2c3d4-e5f6-7890-1234-567890abcdef",
      identifier: "urn:uuid:d1c2c3d4-e5f6-7890-1234-567890abcdef",
      category: "health-care",
      termsOfService: "https://provider.example.com/terms",
      serviceTypePurpose: "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC",
    },
    db: { category: "memory", serviceType: "DATABASE", url: "http://localhost" },
  },
};