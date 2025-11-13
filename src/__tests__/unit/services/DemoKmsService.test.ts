// src/__tests__/unit/services/DemoKmsService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { DemoKmsService } from '../../../services/DemoKmsService';
import { KmsService } from '../../../services/KmsService';
import { CryptographyService } from '../../../crypto/CryptographyService';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { Content } from '../../../utils/content';
import { JobRequest } from '../../../models/request';

describe('DemoKmsService', () => {
    let devKmsService: DemoKmsService;
    let realKmsService: KmsService;

    beforeEach(() => {
        // To test the DemoKmsService decorator, we need a real KmsService to wrap.
        const cryptoService = new CryptographyService();
        const vaultRepository = new VaultMemRepository();
        // The resolver is a lambda to avoid circular dependency issues during instantiation.
        const tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => realKmsService, 'test-host-collection');
        realKmsService = new KmsService(cryptoService, tenantsCacheManager);
        
        devKmsService = new DemoKmsService(realKmsService);
        jest.clearAllMocks();
    });

    describe('provisionKeys and getPublicJwks', () => {
        it('should delegate to the real KMS service to get real keys', async () => {
            // Set DEV_SEED to ensure deterministic key generation for the test
            process.env.DEV_SEED = 'true';
            
            const entityId = 'tenant-123';
            // This now calls the *real* provisionKeys method
            const jwks = await devKmsService.provisionKeys(entityId);
            
            expect(jwks.keys).toHaveLength(2);
            // Check for real crypto properties, not just placeholders
            expect(jwks.keys[0].kty).toBe('AKP');
            expect(jwks.keys[0].alg).toBe('ML-DSA-44');
            expect(jwks.keys[0].pub).toBeDefined();

            const retrievedJwks = await devKmsService.getPublicJwks(entityId);
            expect(retrievedJwks).toEqual(jwks);

            delete process.env.DEV_SEED;
        });
    });

    describe('decodeJobRequest', () => {
        it('should decode a simulated Compact JWE string', async () => {
            // --- Arrange ---
            // 1. The innermost content.
            const innerPayload = { data: 'test' };

            // 2. A simulated JWS containing the content.
            const jwsProtected = { alg: 'ML-DSA-44', kid: 'test-kid' };
            const jwsPayload = { jws: `${Content.objectToRawBase64UrlSafe(jwsProtected)}.${Content.objectToRawBase64UrlSafe(innerPayload)}.fakesig` };
            
            // 3. A simulated Compact JWE containing the JWS payload.
            const jweProtected = Content.objectToRawBase64UrlSafe({ alg: 'none', enc: 'none' });
            const jweCiphertext = Content.objectToRawBase64UrlSafe(jwsPayload);
            const simulatedJwe = `${jweProtected}.key.iv.${jweCiphertext}.tag`;

            // --- Act ---
            const jobRequest = await devKmsService.decodeJobRequest(simulatedJwe);

            // --- Assert ---
            expect(jobRequest).toBeInstanceOf(Object);
            expect(jobRequest.content).toEqual(innerPayload);
            expect(jobRequest.meta?.jws?.protected).toEqual(jwsProtected);
        });

        it('should still handle legacy plaintext JSON', async () => {
            const legacyPayload = { data: 'legacy-test' };
            const jobRequest = await devKmsService.decodeJobRequest(JSON.stringify(legacyPayload));
            expect(jobRequest.content).toEqual(legacyPayload);
        });
    });

    describe('encodeResponse', () => {
        it('should return a simulated Compact JWE string', async () => {
            // --- Arrange ---
            const payload = { success: true };
            const recipientJwk = { kid: 'recipient-kid' };

            // --- Act ---
            const response = await devKmsService.encodeResponse(payload, [recipientJwk], 'sender-id');

            // --- Assert ---
            expect(typeof response).toBe('string');
            const parts = response.split('.');
            expect(parts).toHaveLength(5); // Must be a 5-part compact JWE

            // The 4th part (index 3) is the payload.
            const decodedPayload = Content.base64UrlSafeToJSON(parts[3]);
            expect(decodedPayload).toEqual(payload);

            // The 1st part (index 0) is the protected header.
            const decodedHeader = Content.base64UrlSafeToJSON(parts[0]);
            expect((decodedHeader as any).skid).toBe('dev-sender-kid-for-sender-id');
            expect((decodedHeader as any).kid).toBe('recipient-kid');
        });
    });

    describe('protectConfidentialData', () => {
        it('should move the "content" into a simulated "jwe.ciphertext" property', async () => {
            const originalContent = { sensitive: 'data' };
            const doc: ConfidentialStorageDoc = { id: 'doc1', content: originalContent, sequence: 0 };
            const protectedDoc = await devKmsService.protectConfidentialData(doc, 'tenant-123');

            expect(protectedDoc.content).toBeUndefined();
            expect(protectedDoc.jwe).toBeDefined();
            expect(protectedDoc.jwe?.ciphertext).toBeDefined();

            const decodedContent = Content.base64UrlSafeToJSON(protectedDoc.jwe!.ciphertext as string);
            expect(decodedContent).toEqual(originalContent);
        });
    });

    describe('unprotectConfidentialData', () => {
        it('should retrieve content from the simulated "jwe.ciphertext" property', async () => {
            const originalContent = { sensitive: 'data' };
            // The protected doc now has a base64url-encoded ciphertext property
            const protectedDoc: ConfidentialStorageDoc = { 
                id: 'doc1', 
                jwe: { ciphertext: Content.objectToRawBase64UrlSafe(originalContent) }, 
                sequence: 0 
            };
            
            const result = await devKmsService.unprotectConfidentialData<typeof originalContent>(protectedDoc, 'tenant-123');
            
            expect(result).toEqual(originalContent);
        });

        it('should throw if jwe or jwe.ciphertext is invalid', async () => {
            const invalidDoc1: ConfidentialStorageDoc = { id: 'doc1', jwe: { some: 'field' }, sequence: 0 };
            await expect(devKmsService.unprotectConfidentialData(invalidDoc1, 'tenant-123')).rejects.toThrow();

            const invalidDoc2: ConfidentialStorageDoc = { id: 'doc1', jwe: { ciphertext: null }, sequence: 0 };
            await expect(devKmsService.unprotectConfidentialData(invalidDoc2, 'tenant-123')).rejects.toThrow();
        });
    });
});
