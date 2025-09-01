// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/OrganizationManager.test.ts

import { OrganizationManager } from '../../../managers/OrganizationManager';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import {
    testHostData,
    testInvalidAlternateNameClaims,
    testTenant1Data,
    testTenant1ClaimsOk,
    ClaimRecord,
} from '../../data/organization.data';
import { isValidTenantAlternateName } from "../../../utils/tenant";
import { ClaimsOrgSchemaorg } from '../../../models/schemaorg';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';

// Mock the external dependencies
jest.mock('uuid');
jest.mock('../../../utils/tenant');

describe("OrganizationManager", () => {
    let organizationManager: OrganizationManager;
    let vaultRepository: VaultRepository;

    beforeEach(() => {
        // Use the real in-memory repository for tests
        vaultRepository = new VaultMemRepository(); 
        // Inject the repository into the manager
        organizationManager = new OrganizationManager(vaultRepository);
        
        // Setup default mock implementations for each test
        (uuidv4 as jest.Mock).mockImplementation(() => testHostData.mockedUuid);
        (uuidValidate as jest.Mock).mockReturnValue(true);
        (isValidTenantAlternateName as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ... (test case overview)

    /**
     * Test case [6]: Rejects registration for a tenant with an invalid alternateName.
     */
    it("should reject registration if alternateName is invalid", async () => {
        // ... (existing test case)
    });

    /**
     * Test case [5]: Registers a tenant organization, using an existing valid UUID.
     * This is the "happy path" test.
     */
    it("should register a valid organization and store its configuration", async () => {
        const job = {
            body: {
                data: [{
                    meta: {
                        templateId: testTenant1Data.templateId,
                        templateVersion: testTenant1Data.templateVersion,
                        claims: testTenant1ClaimsOk,
                    },
                }],
            },
        };

        const alternateName = testTenant1ClaimsOk[ClaimsOrgSchemaorg.alternateName];
        const legalName = testTenant1ClaimsOk[ClaimsOrgSchemaorg.legalName];

        // Spy on the repository methods to ensure they are called
        const createVaultSpy = jest.spyOn(vaultRepository, 'createNewVault');
        const putSpy = jest.spyOn(vaultRepository, 'put');

        // Act
        const result = await organizationManager.register(job);

        // Assert
        // 1. Check if the vault was created
        expect(createVaultSpy).toHaveBeenCalledWith({ id: alternateName });

        // 2. Check if the configuration was stored in the 'host' vault
        expect(putSpy).toHaveBeenCalledWith('host', expect.any(Array), 'tenants');
        const savedConfig = (putSpy.mock.calls[0][1] as ClaimRecord[])[0];
        expect(savedConfig.legalName).toBe(legalName);
        expect(savedConfig.alternateName).toBe(alternateName);
        expect(savedConfig.didDocument).toBeDefined();

        // 3. Check the structure of the returned JSON:API document
        expect(result.data[0].type).toBe("template");
        expect(result.included).toHaveLength(3); // Organization, Person, Service
        
        const orgResource = result.included.find((r: any) => r.type === 'Organization');
        expect(orgResource.meta.claims[ClaimsOrgSchemaorg.legalName]).toBe(legalName);
    });
});

