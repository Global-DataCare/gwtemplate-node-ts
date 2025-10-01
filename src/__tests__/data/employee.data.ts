// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/employee.data.ts
import { ClaimsPersonSchemaorg } from '../../models/schemaorg';

/**
*  IMPORTANT!
*  The `hasOccupation` property can be a comma-separated list when more than one role is active at the same time for the same email address.
*/

// ===================================================================================
// DATA DEFINITIONS
// ===================================================================================

// --- Host Admin 1 Details (controller) ---
export const testHostAdmin1 = {
    mockedUuid: "host-admin1-id",
    uuid: "a1b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:a1b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "admin1@host.example.com",
    hasOccupation: "ISCO-08:1120",
};

// --- Tenant 1 - Admin 1 Details (controller) ---
export const testTenant1Admin1 = {
    mockedUuid: "acme-admin1-id",
    uuid: "b1b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:b1b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "admin1@acme.example.com",
    hasOccupation: "ISCO-08:1120",
};

// --- Tenant 1 - Receptionist 1 Details ---
export const testTenant1Receptionist1 = {
    mockedUuid: "acme-receptionist1-id",
    uuid: "11b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:11b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "receptionist1@acme.example.com",
    hasOccupation: "ISCO-08:4226",
};

// --- Tenant 1 - Firefighter 1 Details ---
export const testTenant1Firefighter1 = {
    mockedUuid: "acme-firefighter1-id",
    uuid: "21b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:21b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "firefighter1@acme.example.com",
    hasOccupation: "ISCO-08:5411",
};

// --- Tenant 1 - Nurse 1 Details ---
export const testTenant1Nurse1 = {
    mockedUuid: "acme-nurse1-id",
    uuid: "31b2c3d4-e5f6-7890-1234-567890abcdef",
    identifier: "urn:uuid:31b2c3d4-e5f6-7890-1234-567890abcdef",
    email: "nurse1@acme.example.com",
    hasOccupation: "ISCO-08:2221",
};

// ===================================================================================
// PRE-BUILT CLAIM SETS
// ===================================================================================

export const testClaimsHostAdmin1 = {
    [ClaimsPersonSchemaorg.identifier]: testHostAdmin1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testHostAdmin1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testHostAdmin1.email,
};

export const testClaimsEmployeeAdminTenant1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Admin1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Admin1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Admin1.email,
};

export const testClaimsTenant1Receptionist1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Receptionist1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Receptionist1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Receptionist1.email,
};

export const testClaimsTenant1Firefighter1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Firefighter1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Firefighter1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Firefighter1.email,
};

export const testClaimsTenant1Nurse1 = {
    [ClaimsPersonSchemaorg.identifier]: testTenant1Nurse1.identifier,
    [ClaimsPersonSchemaorg.hasOccupation]: testTenant1Nurse1.hasOccupation,
    [ClaimsPersonSchemaorg.email]: testTenant1Nurse1.email,
};
