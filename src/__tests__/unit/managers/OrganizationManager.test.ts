// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/OrganizationManager.test.ts

import { OrganizationManager } from '../../../managers/OrganizationManager';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import {
    testHostData,
    testTenant1Data,
    testTenant1ClaimsOk,
    testInvalidAlternateNameClaims,
    testTemplateId,
    testTemplateVersion,
    tesInvalidUuid,
    testTenant1BaseValidClaims,
} from '../../data/organization.data';
import { isValidTenantAlternateName } from "../../../utils/tenant";
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg } from '../../../models/schemaorg';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { createHostClaimsFromEnv } from '../../../utils/host';
import { HostEnvVars } from '../../../models/env';

// Mock external dependencies
jest.mock('uuid');
jest.mock('../../../utils/tenant');

describe("OrganizationManager", () => {
    let organizationManager: OrganizationManager;
    let vaultRepository: VaultRepository;
    const originalEnv = process.env;

    // --------------------------
    // --- TEST CASE OVERVIEW ---
    // --------------------------
    /*
    * This test suite covers the following scenarios for the OrganizationManager:
    *
    *  [1] HOST: Registers the 'host' organization with a valid, existing admin UUID.
    *  [2] TENANT: Generates a new UUID if the admin identifier is an invalid UUID (in normal mode).
    *  [3] DEMO: Allows using a non-UUID admin identifier in "demo" mode.
    *  [4] TENANT: Generates a new UUID for the admin if no identifier is provided.
    *  [5] TENANT: Registers a tenant organization with a valid, existing admin UUID (Happy Path).
    *  [6] TENANT: Rejects registration for a tenant with an invalid alternateName.
    *
    *  --- Planned for next cycle ---
    *  [7] TENANT: Rejects registration if the alternateName (tenant-id) already exists.
    *  [8] TENANT: Rejects registration if the taxID + country combination already exists.
    *
    *  --- Future Scenarios (TODO) ---
    *  [9] AUTH: Rejects registration based on caller's permissions.
    *  [10] BATCH: Processes the creation of multiple organizations in a single job.
    *  [11 KEYS: Extracts admin's public keys from JWS/JWE to create their DID and add as 'controller' to the org's DID.
    *  [12] GOVERNANCE: Tests for updating the organization's DID document based on defined policies (e.g., multi-controller approval).
    */

    beforeEach(() => {
        vaultRepository = new VaultMemRepository();
        organizationManager = new OrganizationManager(vaultRepository);
        process.env = { ...originalEnv };
        
        (uuidv4 as jest.Mock).mockImplementation(() => 'new-mocked-uuid-v4');
        (uuidValidate as jest.Mock).mockReturnValue(true);
        (isValidTenantAlternateName as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        jest.clearAllMocks();
        process.env = originalEnv;
    });

    /**
     * Test case [1]: HOST - Registers the 'host' organization.
     */
    it("[1] should register the 'host' organization using claims from environment variables", async () => {
        process.env[HostEnvVars.LEGAL_NAME] = testHostData.legalName;
        process.env[HostEnvVars.JURISDICTION] = testHostData.addressCountry;
        process.env[HostEnvVars.ID_TYPE] = 'TAX';
        process.env[HostEnvVars.ID_VALUE] = testHostData.taxId;
        process.env[HostEnvVars.ADMIN_EMAIL] = testHostData.member.admin1.email;
        process.env[HostEnvVars.ADMIN_ROLE] = testHostData.member.admin1.hasOccupation;
        process.env[HostEnvVars.ADMIN_UID] = testHostData.member.admin1.uuid;
        process.env[HostEnvVars.TERMS_URL] = testHostData.providerTermsOfService;

        const hostClaims = createHostClaimsFromEnv();
        const job = { body: { data: [{ meta: { templateId: testTemplateId, claims: hostClaims } } ]} };

        const result = await organizationManager.register(job);
        
        const personResource = result.included.find((r: any) => r.type === 'Person');
        expect(personResource.id).toBe(testHostData.member.admin1.uuid);
        expect(isValidTenantAlternateName).not.toHaveBeenCalled();
    });

    /**
     * Test case [2]: TENANT - Generates a new UUID if the admin identifier is an invalid UUID.
     */
    it('[2] should generate a new UUID if the admin identifier is an invalid UUID', async () => {
        const invalidClaims = { ...testTenant1ClaimsOk, [ClaimsPersonSchemaorg.identifier]: tesInvalidUuid };
        const job = { body: { data: [{ meta: { templateId: testTemplateId, claims: invalidClaims } }] } };
        (uuidValidate as jest.Mock).mockReturnValue(false);

        const result = await organizationManager.register(job);
        
        const personResource = result.included.find((r: any) => r.type === 'Person');
        expect(personResource.id).toBe('new-mocked-uuid-v4');
    });

    /**
     * Test case [3]: DEMO - Allows non-UUID identifiers.
     */
    it("[3] should accept a non-UUID admin identifier in 'demo' mode", async () => {
        const demoClaims = { ...testTenant1ClaimsOk, [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.mockedUuid };
        const job = { body: { data: [{ meta: { templateId: testTemplateId, claims: demoClaims } }] } };
        (uuidValidate as jest.Mock).mockReturnValue(false);

        const result = await organizationManager.register(job, 'demo');

        const personResource = result.included.find((r: any) => r.type === 'Person');
        expect(personResource.id).toBe(testTenant1Data.member.admin1.mockedUuid);
        expect(uuidv4).not.toHaveBeenCalled();
    });

    /**
     * Test case [4]: TENANT - Generates new UUID if admin identifier is missing.
     */
    it('[4] should generate a new UUID if the admin identifier is not provided', async () => {
        const job = { body: { data: [{ meta: { templateId: testTemplateId, claims: testTenant1BaseValidClaims } }] } };
        const result = await organizationManager.register(job);
        const personResource = result.included.find((r: any) => r.type === 'Person');
        expect(personResource.id).toBe('new-mocked-uuid-v4');
    });

    /**
     * Test case [5]: TENANT - Registers a tenant organization (Happy Path).
     */
    it("[5] should register a valid tenant and store its configuration", async () => {
        const job = { body: { data: [{ meta: { templateId: testTemplateId, claims: testTenant1ClaimsOk } }] } };
        const createVaultSpy = jest.spyOn(vaultRepository, 'createNewVault');

        await organizationManager.register(job);
        
        expect(createVaultSpy).toHaveBeenCalledWith(expect.objectContaining({ id: testTenant1Data.alternateName }));
    });

    /**
     * Test case [6]: TENANT - Rejects invalid alternateName.
     */
    it("[6] should reject registration if alternateName is invalid", async () => {
        const job = { body: { data: [{ meta: { templateId: testTemplateId, claims: testInvalidAlternateNameClaims } }] } };
        (isValidTenantAlternateName as jest.Mock).mockReturnValue(false);
        const invalidName = testInvalidAlternateNameClaims[ClaimsOrgSchemaorg.alternateName];
        const expectedErrorMessage = `Invalid alternateName: '${invalidName}'. Tenant alternateName cannot start or end with 'host'.`;
        await expect(organizationManager.register(job)).rejects.toThrow(expectedErrorMessage);
    });
});

