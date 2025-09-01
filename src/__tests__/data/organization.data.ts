// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from "../../models/schemaorg";

// ---- Host Data ----
const testHostExistingUuid = "existing-valid-uuid-host";
const testHostInvalidUuid = "invalid-uuid-host";
const testHostMockedUuid = 'mocked-uuid-v4-host'; // Mock UUID for consistent testing
const testHostLegalName = "The Host Corporation";
const testHostAddressCountry = "US";
const testHostTaxId = "12-3456789";
const testHostAdminEmail = "host-admin@example.com";
const testHostAdminHasOccupation = "System Administrator";
const testHostProviderCategory = "Cloud Hosting";
const testHostProviderTermsOfService = "https://host.example.com/terms";
const testHostProviderServiceType = "http://example.com/service-type";
const testHostTemplateId = "OrgRegistrationForm";
const testHostTemplateVersion = "1.0";
const testHostValidIdentifier = `urn:uuid:${testHostExistingUuid},urn:ml-dsa:rfc7638:keyid,urn:ml-kem:rfc7638:keyid`;

// ---- TENANT1 Data ----
const testTenant1ExistingUuid = "existing-valid-uuid-tenant1";
const testTenant1InvalidUuid = "invalid-uuid-tenant1";
const testTenant1MockedUuid = 'mocked-uuid-v4-tenant1'; // Mock UUID for consistent testing
const testTenant1LegalName = "Tenant One, Inc.";
const testTenant1AlternateName = "tenant1"; // Define a constant for clarity
const testTenant1AddressCountry = "CA";
const testTenant1TaxId = "98-7654321";
const testTenant1AdminEmail = "tenant1-admin@example.com";
const testTenant1AdminHasOccupation = "Operations Manager";
const testTenant1ProviderCategory = "Consulting";
const testTenant1ProviderTermsOfService = "https://tenant1.example.com/terms";
const testTenant1ProviderServiceType = "http://tenant1.example.com/service-type";
const testTenant1TemplateId = "OrgRegistrationForm";
const testTenant1TemplateVersion = "1.0";
const testTenant1ValidIdentifier = `urn:uuid:${testTenant1ExistingUuid},urn:ml-dsa:rfc7638:keyid,urn:ml-kem:rfc7638:keyid`;

// --- Group Data into Objects ---
export const testHostData = {
    existingUuid: testHostExistingUuid,
    invalidUuid: testHostInvalidUuid,
    mockedUuid: testHostMockedUuid,
    legalName: testHostLegalName,
    addressCountry: testHostAddressCountry,
    taxId: testHostTaxId,
    adminEmail: testHostAdminEmail,
    adminHasOccupation: testHostAdminHasOccupation,
    providerCategory: testHostProviderCategory,
    providerTermsOfService: testHostProviderTermsOfService,
    providerServiceType: testHostProviderServiceType,
    templateId: testHostTemplateId,
    templateVersion: testHostTemplateVersion,
    validIdentifier: testHostValidIdentifier,
};

export const testTenant1Data = {
    existingUuid: testTenant1ExistingUuid,
    invalidUuid: testTenant1InvalidUuid,
    mockedUuid: testTenant1MockedUuid,
    legalName: testTenant1LegalName,
    addressCountry: testTenant1AddressCountry,
    taxId: testTenant1TaxId,
    adminEmail: testTenant1AdminEmail,
    adminHasOccupation: testTenant1AdminHasOccupation,
    providerCategory: testTenant1ProviderCategory,
    providerTermsOfService: testTenant1ProviderTermsOfService,
    providerServiceType: testTenant1ProviderServiceType,
    templateId: testTenant1TemplateId,
    templateVersion: testTenant1TemplateVersion,
    validIdentifier: testTenant1ValidIdentifier,
};

// Using a Record type for claims for flexibility
export type ClaimRecord = Record<string, any>;

// ---- Host ORG Claims ----
export const testOrg1BaseValidClaims: ClaimRecord = {
    "@context": "org.schema",
    "@type": "template",
    [ClaimsOrgSchemaorg.legalName]: testHostData.legalName,
    [ClaimsOrgSchemaorg.addressCountry]: testHostData.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testHostData.taxId,
    [ClaimsPersonSchemaorg.email]: testHostData.adminEmail,
    [ClaimsPersonSchemaorg.hasOccupation]: testHostData.adminHasOccupation,
    [ClaimsServiceSchemaorg.category]: testHostData.providerCategory,
    [ClaimsServiceSchemaorg.serviceType]: testHostData.providerServiceType,
    [ClaimsServiceSchemaorg.termsOfService]: testHostData.providerTermsOfService,
};

export const testOrg1ClaimsOk: ClaimRecord = {
    ...testOrg1BaseValidClaims,
    [ClaimsPersonSchemaorg.identifier]: testHostData.validIdentifier,
};

export const testOrg1ClaimsAdminIdentifierMissing: ClaimRecord = {
    ...testOrg1BaseValidClaims,
};

export const testOrg1ClaimsAdminIdentifierInvalid: ClaimRecord = {
    ...testOrg1BaseValidClaims,
    [ClaimsPersonSchemaorg.identifier]: testHostData.invalidUuid,
};

// ---- Tenant 1 ORG Claims ----
export const testTenant1BaseValidClaims: ClaimRecord = {
    "@context": "org.schema",
    "@type": "template",
    [ClaimsOrgSchemaorg.legalName]: testTenant1Data.legalName,
    [ClaimsOrgSchemaorg.alternateName]: testTenant1AlternateName, // Add the missing claim
    [ClaimsOrgSchemaorg.addressCountry]: testTenant1Data.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testTenant1Data.taxId,
    [ClaimsPersonSchemaorg.email]: testTenant1Data.adminEmail,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Data.adminHasOccupation,
    [ClaimsServiceSchemaorg.category]: testTenant1Data.providerCategory,
    [ClaimsServiceSchemaorg.serviceType]: testTenant1Data.providerServiceType,
    [ClaimsServiceSchemaorg.termsOfService]: testTenant1Data.providerTermsOfService,
};

export const testTenant1ClaimsOk: ClaimRecord = {
    ...testTenant1BaseValidClaims,
    [ClaimsPersonSchemaorg.identifier]: testTenant1Data.validIdentifier,
};

export const testTenant1ClaimsAdminIdentifierMissing: ClaimRecord = {
    ...testTenant1BaseValidClaims,
};

export const testTenant1ClaimsAdminIdentifierInvalid: ClaimRecord = {
    ...testTenant1BaseValidClaims,
    [ClaimsPersonSchemaorg.identifier]: testTenant1Data.invalidUuid,
};

// --- Test Claims for Specific Scenarios ---
export const testInvalidAlternateNameClaims: ClaimRecord = {
    ...testTenant1BaseValidClaims,
    [ClaimsOrgSchemaorg.alternateName]: "host-is-not-valid",
};

