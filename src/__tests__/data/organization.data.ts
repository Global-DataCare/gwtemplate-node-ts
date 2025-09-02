// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__test__/data/organization.data.ts

import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from "../../models/schemaorg";

// Using a Record type for claims for flexibility
export type ClaimRecord = Record<string, any>;

// --- Common data for the tests ---
export const testTemplateId = "OrgRegistrationForm";
export const testTemplateVersion = "1.0";
export const tesInvalidUuid = "invalid-uuid";
export const testMockedUuid = 'mocked-uuid-v4';
// ---- Host Data ----
const testHostAlternateName = "host";
const testHostLegalName = "Host Organization";
const testHostAddressCountry = "ES";
const testHostTaxId = "12-3456789";
const testHostProviderCategory = "<sector>";
const testHostProviderTermsOfService = "https://host.example.com/terms";
const testHostProviderServiceType = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC"; // the purpose list defines the service type

// --- Host Admin 1 ---
const testHostAdmin1MockedUuid = "host-admin1-id";
const testHostAdmin1Uuid = "a1b2c3d4-e5f6-7890-1234-567890abcdef";
const testHostAdmin1Identifier = `urn:uuid:${testHostAdmin1Uuid}`;
const testHostAdmin1Email = "host-admin1@example.com";
const testHostAdmin1HasOccupation = "ISCO-08:1120";

// ---- TENANT1 Data ----
const testTenant1LegalName = "Tenant One";
const testTenant1AlternateName = "tenant1";
const testTenant1AddressCountry = "FR";
const testTenant1TaxId = "98-7654321";
const testTenant1ProviderCategory = "<sector>";
const testTenant1ProviderTermsOfService = "https://tenant1.example.com/terms";
const testTenant1ProviderServiceType = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC"; // the purpose list defines the service type

// --- TENANT1: Admin 1 ---
const testTenant1Admin1MockedUuid = "tenant1-admin1-id";
const testTenant1Admin1Uuid = "b1b2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1Admin1Identifier = `urn:uuid:${testTenant1Admin1Uuid}`;
const testTenant1Admin1Email = "tenant1-admin1@example.com";
const testTenant1Admin1HasOccupation = "ISCO-08:1120";

// --- Group Data into Objects ---
export const testHostData = {
    addressCountry: testHostAddressCountry,
    legalName: testHostLegalName,
    taxId: testHostTaxId,
    providerCategory: testHostProviderCategory,
    providerTermsOfService: testHostProviderTermsOfService,
    providerServiceType: testHostProviderServiceType,
    member: {
        admin1: {
            email: testHostAdmin1Email,
            hasOccupation: testHostAdmin1HasOccupation,
            identifier: testHostAdmin1Identifier,
            uuid: testHostAdmin1Uuid,
            mockedUuid: testHostAdmin1MockedUuid
        }
    }
};

export const testTenant1Data = {
    addressCountry: testTenant1AddressCountry,
    legalName: testTenant1LegalName,
    alternateName: testTenant1AlternateName,
    taxId: testTenant1TaxId,
    providerCategory: testTenant1ProviderCategory,
    providerTermsOfService: testTenant1ProviderTermsOfService,
    providerServiceType: testTenant1ProviderServiceType,
    member: {
        admin1: {
            email: testTenant1Admin1Email,
            hasOccupation: testTenant1Admin1HasOccupation,
            identifier: testTenant1Admin1Identifier,
            uuid: testTenant1Admin1Uuid,
            mockedUuid: testTenant1Admin1MockedUuid
        }
    }
};

// ---- Base Claims ----
const baseClaims: Omit<ClaimRecord, "org.schema.Organization.legalName"> = {
    "@context": "org.schema",
    "@type": "template",
};

// ---- Host Claims ----
export const testHostBaseClaims: ClaimRecord = {
    ...baseClaims,
    [ClaimsOrgSchemaorg.legalName]: testHostData.legalName,
    [ClaimsOrgSchemaorg.addressCountry]: testHostData.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testHostData.taxId,
    [ClaimsPersonSchemaorg.email]: testHostData.member.admin1.email,
    [ClaimsPersonSchemaorg.hasOccupation]: testHostData.member.admin1.hasOccupation,
    [ClaimsServiceSchemaorg.category]: testHostData.providerCategory,
    [ClaimsServiceSchemaorg.serviceType]: testHostData.providerServiceType,
    [ClaimsServiceSchemaorg.termsOfService]: testHostData.providerTermsOfService,
};

export const testHostClaimsOk: ClaimRecord = {
    ...testHostBaseClaims,
    [ClaimsPersonSchemaorg.identifier]: testHostData.member.admin1.identifier,
};


// ---- Tenant 1 Claims ----
export const testTenant1BaseValidClaims: ClaimRecord = {
    ...baseClaims,
    [ClaimsOrgSchemaorg.legalName]: testTenant1Data.legalName,
    [ClaimsOrgSchemaorg.alternateName]: testTenant1Data.alternateName,
    [ClaimsOrgSchemaorg.addressCountry]: testTenant1Data.addressCountry,
    [ClaimsOrgSchemaorg.taxID]: testTenant1Data.taxId,
    [ClaimsPersonSchemaorg.email]: testTenant1Data.member.admin1.email,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Data.member.admin1.hasOccupation,
    [ClaimsServiceSchemaorg.category]: testTenant1Data.providerCategory,
    [ClaimsServiceSchemaorg.serviceType]: testTenant1Data.providerServiceType,
    [ClaimsServiceSchemaorg.termsOfService]: testTenant1Data.providerTermsOfService,
};

export const testTenant1ClaimsOk: ClaimRecord = {
    ...testTenant1BaseValidClaims,
    [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.identifier,
};

// --- Test Claims for Specific Scenarios ---
export const testInvalidAlternateNameClaims: ClaimRecord = {
    ...testTenant1BaseValidClaims,
    [ClaimsOrgSchemaorg.alternateName]: "host-is-not-valid",
};

