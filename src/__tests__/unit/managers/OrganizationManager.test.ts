// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/OrganizationManager.test.ts

import { jest } from '@jest/globals';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { OrganizationManager } from '../../../managers/OrganizationManager';
import {
    testHostData,
    testTenant1Data,
    testTemplateId,
    testTemplateVersion,
    tesInvalidUuid,
    testClaimsTenant1AlternateNameInvalidPrefix,
    testClaimsTenant1Registration,
    testClaimsHostInitialization,
} from '../../data/organization.data';
import { isValidTenantAlternateName } from "../../../utils/tenant";
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../../../models/schemaorg';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { JobRequest } from '../../../models/request';
import { ClaimsRecord } from '../../../models/resource-document';
import { TenantConfig } from '../../../models/tenant';
import { IKmsService } from '../../../security/interfaces/IKmsService';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';

// Mock external dependencies
jest.mock('uuid');
jest.mock('../../../utils/tenant');

// Create a mock KMS service for testing.
// Create a complete mock KMS service for testing to satisfy the IKmsService interface.
const mockKmsService: jest.Mocked<IKmsService> = {
    decodeRequest: jest.fn(),
    encodeResponse: jest.fn(),
    protectDocument: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
        // Simulate the KMS encrypting the content and moving it to the JWE property.
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete secureDoc.content;
        return secureDoc;
    }),
    unprotectDocument: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) => Promise.resolve(doc.content as any)),
    getDidDocument: jest.fn(),
    getPublicJwks: jest.fn(),
    getPublicVerificationKey: jest.fn(),
    getPublicEncryptionKey: jest.fn(),
    sign: jest.fn(),
    verify: jest.fn(),
};

const testBaseJobForClaims = (claims: ClaimsRecord): JobRequest => ({

    tenantId: claims[ClaimsOrgSchemaorg.alternateName || 'host'],
    jurisdiction: claims[ClaimsOrgSchemaorg.addressCountry],
    resourceType: 'Organization',
    section: 'org.schema',
    action: '_batch',
    input: {
        aud: 'did:web:antifraud.example.com',
        /** contains `json` or `fhir+json` */
        response_type: "json",
        thid: 'test-thid-123',
        type: 'json',
        body: {
            data: [{
                meta: { claims },
                request: {
                    method: "POST"
                },
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

    // --------------------------
    // --- TEST CASE OVERVIEW ---
    // --------------------------
    /*
    * This test suite covers the synchronous, business-logic-only responsibilities of the OrganizationManager.
    *
    *  [1] HOST: Registers the 'host' organization with a valid, existing admin UUID.
    *  [2] TENANT: Generates a new UUID if the admin identifier is an invalid UUID (in normal mode).
    *  [3 DEMO: Allows using a non-UUID admin identifier in "demo" mode.
    *  [4] TENANT: Generates a new UUID for the admin if no identifier is provided.
    *  [5] TENANT: Registers a tenant organization, encrypting the content before persistence (Happy Path).
    *  [6] TENANT: Rejects registration for a tenant with an invalid alternateName format.
    *  [7] TENANT: Rejects registration if the alternateName (tenant-id) already exists.
    *  [8] TENANT: Rejects registration if the taxID + country combination already exists.
    *
    *  --- Future Scenarios (TODO) ---
    *  [9 AUTH: Rejects registration based on caller's permissions.
    *  [10 BATCH: Processes the creation of multiple organizations in a single job.
    *  [11 KEYS: Extracts admin's public keys from JWS/JWE to create their DID and add as 'controller' to the org's DID.
    *  [12 GOVERNANCE: Tests for updating the organization's DID document based on defined policies (e.g., multi-controller approval).
    */

    beforeEach(() => {
        vaultRepository = new VaultMemRepository();
        // Inject both the repository and the mock KMS service.
        organizationManager = new OrganizationManager(vaultRepository, mockKmsService);
        process.env = { ...originalEnv };
        
        // Reset mocks before each test
        jest.clearAllMocks();

        (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
        (uuidValidate as jest.Mock).mockReturnValue(true);
        (isValidTenantAlternateName as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('[5] TENANT (Happy Path): should use the KMS to protect the document before persisting', async () => {
        const job = testBaseJobForClaims(testClaimsTenant1Registration);
        const putSpy = jest.spyOn(vaultRepository, 'put');

        await organizationManager.process(job);
        
        // --- Security and Persistence Assertions ---
        expect(mockKmsService.protectDocument).toHaveBeenCalledTimes(1);

        // Verify the document passed to the KMS had plaintext content.
        const docToProtect = mockKmsService.protectDocument.mock.calls[0][0];
        expect(docToProtect.content).toBeDefined();
        expect(docToProtect.content?.legalName).toBe(testTenant1Data.legalName);

        // Verify that the document passed to the repository for storage is the secure one.
        expect(putSpy).toHaveBeenCalledTimes(1);
        const savedDoc = putSpy.mock.calls[0][1][0] as ConfidentialStorageDoc;
        expect(savedDoc.content).toBeUndefined();
        expect(savedDoc.jwe).toBeDefined();
    });


    it("[1] HOST: should process the 'host' initialization", async () => {
        const job = testBaseJobForClaims(testClaimsHostInitialization);
        const responsePayload = await organizationManager.process(job);

        expect(isValidTenantAlternateName).not.toHaveBeenCalled();
        const entry = responsePayload.body.data[0];
        expect(entry.response.status).toBe('201');


        // Type guard assertion
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        const job = testBaseJobForClaims(testClaimsTenant1AlternateNameInvalidPrefix);
        (isValidTenantAlternateName as jest.Mock).mockReturnValue(false);

        const responsePayload = await organizationManager.process(job);
        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('400');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Invalid alternateName');
    });

    it("[7] TENANT: should produce an error entry if alternateName already exists", async () => {
        jest.spyOn(vaultRepository, 'vaultExists').mockResolvedValue(true);
        const job = testBaseJobForClaims(testClaimsTenant1Registration);

        const responsePayload = await organizationManager.process(job);
        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('409');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('already exists');
    });

    it("[8] TENANT: should produce an error entry if taxID and country combination already exists", async () => {
        const existingConfig: Partial<TenantConfig> = { identifier: testTenant1Data.taxId, jurisdiction: testTenant1Data.addressCountry };

        jest.spyOn(vaultRepository, 'getContainersInSection').mockResolvedValue([existingConfig as TenantConfig]);
        const job = testBaseJobForClaims(testClaimsTenant1Registration);

        const responsePayload = await organizationManager.process(job);
        const errorEntry = responsePayload.body.data[0];
        expect(errorEntry.response.status).toBe('409');
        expect(errorEntry.response.outcome.issue[0].diagnostics).toContain("already exists");
    });
});
