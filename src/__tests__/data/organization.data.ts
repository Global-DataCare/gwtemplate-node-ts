// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/organization.base.data.ts

import { EntityConfig } from "../../models/entity";
import { URN_NAMESPACE, URN_NETWORK, URN_VERSION } from "./urn.data";
import { ClaimsOrganizationSchemaorg } from "../../models/schemaorg";
import { testTenant1Vc } from "./credential.data";

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
export const codeSystemISCO08 = `ISCO-08`;

// ===================================================================================
// ROOT ENTITY DATA
// ===================================================================================
export const testRootOrgDidWeb = `did:web:testca.unid.es`; // https://testca.unid.es/.well-known/did.json 

// ===================================================================================
// HOST ORGANIZATION DATA
// ===================================================================================
// --- Host Organization Details ---
const testHostUuid = "d1d2d3d4-e5f6-7890-1234-567890abcdef";
export const testHostAlternateName = "host";
export const testHostAddressCountry = "ES";
export const testHostIdType = "TAX"; // TAX or EI (TODO: link)
export const testHostIdValue = "B12345678";
export const testHostLegalName = "Hosting Organization";

export const testHostDomain = "host.example.com"
export const testHostExternalUrl = `https://${testHostDomain}`
export const testHostDidWebIdentifier = `did:web:${testHostDomain}`

// Software Service for Host
const testServiceManufacturerDidWebIdentifier = `urn:web:<manufacturer>`;
const testServiceManufacturerCategory = "system";
const testServiceManufacturerTerms = "https://github.com/<manufacturer>/<software>/terms";
const testServiceManufacturerPurposeType = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC";

// --- Host Admin 1 Details ---
const testHostAdmin1Uuid = "a1b2c3d4-e5f6-7890-1234-567890abcdef";
export const testHostAdmin1Email = `admin1@${testHostDomain}`;
export const testHostAdmin1HasOccupation = `${codeSystemISCO08}:1120`; // 2 segments (<system>:<code>)
export const testHostAdmin1UrnIdentifier = `urn:${URN_NAMESPACE}:${URN_NETWORK}:${testHostAddressCountry}:v1:${testServiceManufacturerCategory}:entity:${testHostIdType}:${testHostIdValue}:employee:email:${testHostAdmin1Email}:role:${testHostAdmin1HasOccupation}`;

// ===================================================================================
// TENANT 1 ORGANIZATION DATA
// ===================================================================================
// --- Tenant 1 Organization Details ---
export const testTenant1LegalName = "Acme Company";
export const testTenant1AddressCountry = "US";
export const testTenant1IdType = "EI"; // EI or TAX
export const testTenant1IdValue = "98-7654321";
export const testTenant1AlternateName = "acme";
const testTenant1Uuid = "c1c2c3d4-e5f6-7890-1234-567890abcdef";

// --- Tenant 1 - Service Provider Details ---
// const testTenant1ServiceProviderUuid = "d1c2c3d4-e5f6-7890-1234-567890abcdef";
const testTenant1ServiceProviderDidWebIdentifier = testHostDidWebIdentifier;
export const testTenant1ServiceProviderCategory = "health-care"; // Using 'health-care' as the sector.
const testTenant1ServiceProviderTerms = "https://provider.example.com/terms";
const testTenant1ServiceProviderPurposeType = "http://terminology.hl7.org/CodeSystem/v3-ActReason|SRVC";

/** The Tenant's identifier a static, canonical semantic URN.
 *  This is the ID that will be used in the 'credentialSubject.identifier' of its Pointer Credential.
 *  For example: `urn:antifraud:test-network:ES:v1:health-care:entity:EI:98-7654321`
 */
export const testTenant1UrnIdentifier = 
  `urn:${URN_NAMESPACE}:${URN_NETWORK}:${testTenant1AddressCountry}:${URN_VERSION}:${testTenant1ServiceProviderCategory}:entity:${testTenant1IdType}:${testTenant1IdValue}`;

/** Tenant's 1 external domain */
export const testTenant1Domain = "acme.org";
export const testTenant1ExternalUrl = `https://${testTenant1Domain}`
export const testTenant1DidWebExternalIdentifier = `did:web:${testTenant1Domain}`;
/** Hosted did:web = did:web:host.example.com:acme:us:v1:health-care */
export const testTenant1DidWebHostedIdentifier = `did:web:${testHostDomain}:${testTenant1AlternateName}:${testTenant1AddressCountry}:v1:${testTenant1ServiceProviderCategory}`;

// --- Tenant 1 - Admin 1 Details ---
const testTenant1Admin1MockedUuid = "acme-admin1-id";
const testTenant1Admin1Uuid = "b1b2c3d4-e5f6-7890-1234-567890abcdef";
export const testTenant1Admin1Identifier = `urn:uuid:${testTenant1Admin1Uuid}`;
export const testTenant1Admin1Email = `admin@${testTenant1Domain}`;
export const testTenant1Admin1HasOccupation = "ISCO-08:1120";

// ===================================================================================
// HOST CONFIG DATA
// ===================================================================================
// The entity configuration should have "type" of claims, the "claims" object,
// and "included" objects (services) such as provider and database resources.
export const testConfigDataHost: EntityConfig = {
  id: testHostUuid,
  meta: { lastUpdated: '' },
  status: 'active',
  type: "org.schema.Organization", // type of claims
  claims: {
    [ClaimsOrganizationSchemaorg.legalName]: testHostLegalName,
    [ClaimsOrganizationSchemaorg.identifierType]: testHostIdType,
    [ClaimsOrganizationSchemaorg.identifierValue]: testHostIdValue,
    [ClaimsOrganizationSchemaorg.identifier]: testHostDidWebIdentifier,
    [ClaimsOrganizationSchemaorg.alternateName]: testHostAlternateName,
    [ClaimsOrganizationSchemaorg.addressCountry]: testHostAddressCountry,
    // [ClaimsOrgSchemaorg.taxID]: testHostData.taxId,    
  },

  /** --- DEPRECATED --- */
  // identifier: "urn:uuid:d1d2d3d4-e5f6-7890-1234-567890abcdef",
  /* alternateName: testHostAlternateName,
  addressCountry: testHostAddressCountry,
  identifierType: testHostIdType,
  identifierValue: testHostIdValue,
  legalName: testHostLegalName, */
  // taxId: testTenant1TaxId,  
  /** --- --- --- --- */

  didConfig: {
    service:[]
  },

  didDocument: {
    '@context': ``,
    id: ``,
  },

  provider: {
    db: { category: "MEMORY", serviceType: "DATABASE", url: "http://localhost" },
    service: {
      // id: testHostProviderUuid, // uuid
      identifier: testServiceManufacturerDidWebIdentifier, // did:web
      sectorCategory: testServiceManufacturerCategory,
      serviceType: testServiceManufacturerPurposeType,
      termsOfService: testServiceManufacturerTerms,
    },
  },
  vp: [testTenant1Vc]
};

// ===================================================================================
// TENANT 1 ORGANIZATION BASE DATA
// ===================================================================================
export const testConfigTenant1: EntityConfig = {
  id: testTenant1Uuid,
  meta: { lastUpdated: '' },
  status: 'active',
  type: "org.schema.Organization", // type of claims
  claims: {
    [ClaimsOrganizationSchemaorg.legalName]: testTenant1LegalName,
    [ClaimsOrganizationSchemaorg.identifierType]: testTenant1IdType,
    [ClaimsOrganizationSchemaorg.identifierValue]: testTenant1IdValue,
    [ClaimsOrganizationSchemaorg.identifier]: testTenant1DidWebHostedIdentifier, // this is the fixed, static one. The external did:web can vary with the domain
    [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
    [ClaimsOrganizationSchemaorg.addressCountry]: testTenant1AddressCountry,
    // [ClaimsOrgSchemaorg.taxID]: testHostData.taxId,    
  },
  
  /** --- DEPRECATED --- */
  // identifier: "urn:uuid:c1c2c3d4-e5f6-7890-1234-567890abcdef",
  /* addressCountry: testTenant1AddressCountry,
  identifierType: testTenant1IdType,
  identifierValue: testTenant1IdValue,
  // taxId: "98-7654321",
  legalName: testTenant1LegalName,
  alternateName: testTenant1AlternateName,
  url: "https://acme.example.com", //external URL, not provided by the host in this case
  */
  /** --- --- */
  
  didConfig: {
    service:[]
  },

  didDocument: {
    '@context': ``,
    id: ``,
  },  
  
  provider: {
    db: { category: "memory", serviceType: "DATABASE", url: "http://localhost" },
    service: {
      // uuid: testTenant1ServiceProviderUuid,
      identifier: testTenant1ServiceProviderDidWebIdentifier,
      sectorCategory: testTenant1ServiceProviderCategory,
      termsOfService: testTenant1ServiceProviderTerms,
      serviceTypePurpose: testTenant1ServiceProviderPurposeType,
    },
    vp: [testTenant1Vc]
  },
};