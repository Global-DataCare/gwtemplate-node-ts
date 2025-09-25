// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/OrganizationManager.test.ts

import { jest } from '@jest/globals';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { OrganizationManager } from '../../../managers/OrganizationManager';
import {
    testHostData,
    testTenant1Data,
    testTenant1VaultId,
    tesInvalidUuid,
    testClaimsTenant1AlternateNameInvalidPrefix,
    testClaimsTenant1Registration,
    testClaimsHostInitialization,
} from '../../data/organization.data';
import * as tenantUtils from "../../../utils/tenant";
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../../../models/schemaorg';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { JobRequest } from '../../../models/request';
import { ClaimsRecord } from '../../../models/resource-document';
import { TenantConfig } from '../../../models/tenant';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { config as appConfig } from '../../../config';
import { Sector } from '../../../models/sector';

// Mock external dependencies
jest.mock('uuid');

// Create a mock KMS service for testing.
const mockKmsService: jest.Mocked<IKmsService> = {
    init: jest.fn(async () => {}),
    provisionKeys: jest.fn(),
    decodeJobRequest: jest.fn(),
    signWithManagedKey: jest.fn(),
    signWithReconstructedKey: jest.fn(),
    encodeResponse: jest.fn(),
    protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete secureDoc.content;
        return secureDoc;
    }),
    unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) => Promise.resolve(doc.content as any)),
    getPublicJwks: jest.fn(),
    getPublicVerificationKey: jest.fn(),
    getPublicEncryptionKey: jest.fn(),
};

const testBaseJobForClaims = (claims: ClaimsRecord): JobRequest => ({
    // Correctly derive tenantId from claims or default to 'host'
    tenantId: claims[ClaimsOrgSchemaorg.alternateName] || 'host',
    jurisdiction: claims[ClaimsOrgSchemaorg.addressCountry],
    resourceType: 'Organization',
    section: 'org.schema',
    action: '_batch',
    input: {
        aud: 'did:web:api.example.com',
        response_type: "json",
        thid: 'test-thid-123',
        type: 'json',
        body: {
            data: [{
                meta: { claims },
                request: { method: "POST" },
                type: 'Organization-registration-form-v1.0',
            }]
        }
    },
    httpMethod: 'POST',
    fullUrl: '/default',
});

describe("OrganizationManager", () => {
    let organizationManager: OrganizationManager;
    let vaultRepository: VaultRepository;
    const originalEnv = process.env;

    beforeAll(() => {
        // Mock the allowed sectors for all tests in this suite
        appConfig.sectorsAllowed = [Sector.HEALTH_CARE, Sector.SYSTEM];
    });

    beforeEach(() => {
        vaultRepository = new VaultMemRepository();
        organizationManager = new OrganizationManager(vaultRepository, mockKmsService);
        process.env = { ...originalEnv };
        
        jest.clearAllMocks();

        (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
        (uuidValidate as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('[5 TENANT (Happy Path): should use the KMS to protect the document before persisting', async () => {
        const job = testBaseJobForClaims(testClaimsTenant1Registration);
        const putSpy = jest.spyOn(vaultRepository, 'put');
        const createVaultSpy = jest.spyOn(vaultRepository, 'createNewVault');

        await organizationManager.process(job);
        
        expect(createVaultSpy).toHaveBeenCalledWith(expect.objectContaining({ id: testTenant1VaultId }));
        expect(mockKmsService.provisionKeys).toHaveBeenCalledWith(testTenant1VaultId);
        expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(1);

        const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
        expect(docToProtect.content).toBeDefined();
        expect(docToProtect.content?.legalName).toBe(testTenant1Data.legalName);

        expect(putSpy).toHaveBeenCalledTimes(1);
        const savedDoc = putSpy.mock.calls[0][1][0] as ConfidentialStorageDoc;
        expect(savedDoc.content).toBeUndefined();
        expect(savedDoc.jwe).toBeDefined();
    });


    it("[1] HOST: should process the 'host' initialization", async () => {
        const job = testBaseJobForClaims(testClaimsHostInitialization);
        const responsePayload = await organizationManager.process(job);

        const entry = responsePayload.body.data[0];
        expect(entry.response.status).toBe('201');

        expect(entry.resource).toBeDefined();
        const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
        expect(person.id).toBe(testHostData.member.admin1.uuid);
    });

    it("[3] DEMO: should use a non-UUID identifier directly in 'demo' mode", async () => {
        const demoClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.mockedUuid };
        const job = testBaseJobForClaims(demoClaims);
        (uuidValidate as jest.Mock).mockReturnValue(false);

        const responsePayload = await organizationManager.process(job, 'demo');

        const entry = responsePayload.body.data[0];
        expect(entry.resource).toBeDefined();
        const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
        expect(person.id).toBe(testTenant1Data.member.admin1.mockedUuid);
        expect(uuidv4).not.toHaveBeenCalled();
    });

    it("[2] TENANT: should generate a new UUID for an invalid identifier", async () => {
        const invalidClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: tesInvalidUuid };
        const job = testBaseJobForClaims(invalidClaims);
        (uuidValidate as jest.Mock).mockReturnValue(false);

        const responsePayload = await organizationManager.process(job);

        const entry = responsePayload.body.data[0];
        expect(entry.resource).toBeDefined();
        const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
        expect(person.id).toBe('new-mocked-uuid-v4');
    });

    it("[4] TENANT: should generate a new UUID if identifier claim is missing", async () => {
        const { [ClaimsPersonSchemaorg.identifier]: _, ...noIdClaims } = testClaimsTenant1Registration;
        const job = testBaseJobForClaims(noIdClaims as ClaimsRecord);
        (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');

        const responsePayload = await organizationManager.process(job);

        const entry = responsePayload.body.data[0];
        expect(entry.resource).toBeDefined();
        const person = entry.resource!.contained.find((r: any) => r.type === 'Person');
        expect(person.id).toBe('new-mocked-uuid-v4');
    });

    it("[6] TENANT: should produce an error entry for an invalid alternateName format", async () => {
        // Temporarily spy on and mock the return value for this specific test
        const isValidSpy = jest.spyOn(tenantUtils, 'isValidTenantAlternateName').mockReturnValue(false);
        const job = testBaseJobForClaims(testClaimsTenant1AlternateNameInvalidPrefix);

        const responsePayload = await organizationManager.process(job);
        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('400');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Invalid alternateName');
        
        isValidSpy.mockRestore(); // Clean up the spy
    });

    it("[7] TENANT: should produce an error entry if vaultId already exists", async () => {
        const vaultExistsSpy = jest.spyOn(vaultRepository, 'vaultExists').mockResolvedValue(true);
        const job = testBaseJobForClaims(testClaimsTenant1Registration);

        const responsePayload = await organizationManager.process(job);

        expect(vaultExistsSpy).toHaveBeenCalledWith(testTenant1VaultId);
        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('409');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(`a vault for '${testTenant1VaultId}' already exists`);
    });
    
    it("[8] TENANT: should produce an error entry if taxID and country combination already exists", async () => {
        const existingConfig: Partial<TenantConfig> = { identifier: testTenant1Data.taxId, jurisdiction: testTenant1Data.addressCountry, sector: Sector.HEALTH_CARE };
        jest.spyOn(vaultRepository, 'getContainersInSection').mockResolvedValue([existingConfig as TenantConfig]);
        const job = testBaseJobForClaims(testClaimsTenant1Registration);

        const responsePayload = await organizationManager.process(job);

        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('409');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain("already exists");
    });

    it('[9] TENANT: should produce an error entry if sector claim contains multiple values', async () => {
        const claimsWithMultipleSectors = {
            ...testClaimsTenant1Registration,
            [ClaimsServiceSchemaorg.category]: 'health-care,insurance',
        };
        const job = testBaseJobForClaims(claimsWithMultipleSectors);
        
        const responsePayload = await organizationManager.process(job);
        
        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('400');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Multiple sectors (comma-separated) are not allowed');
        expect(errorEntry.response.outcome.issue[0].code).toBe('value');
    });
});