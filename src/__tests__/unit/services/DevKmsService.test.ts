// src/__tests__/unit/services/DevKmsService.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { jest } from '@jest/globals';
import { DevKmsService } from '../../../services/DevKmsService';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { Content } from '../../../utils/content';
import { JobRequest } from '../../../models/request';

describe('DevKmsService', () => {
    let devKmsService: DevKmsService;

    beforeEach(() => {
        devKmsService = new DevKmsService();
        jest.clearAllMocks();
    });

    describe('provisionKeys and getPublicJwks', () => {
        it('should return a consistent, fake JWKSet for an entityId', async () => {
            const entityId = 'tenant-123';
            const jwks = await devKmsService.provisionKeys(entityId);
            
            expect(jwks.keys).toHaveLength(2);
            expect(jwks.keys[0].kty).toBe('AKP');
            expect(jwks.keys[1].kty).toBe('OKP');

            const retrievedJwks = await devKmsService.getPublicJwks(entityId);
            expect(retrievedJwks).toEqual(jwks);
        });
    });

    describe('decodeJobRequest', () => {
        it('should parse a stringified JWE containing a JWS payload', async () => {
            const innerPayload = { data: 'test' };
            const innerProtected = { alg: 'ML-DSA-44', kid: 'test-kid' };
            const compactJws = `${Content.objectToRawBase64UrlSafe(innerProtected)}.${Content.objectToRawBase64UrlSafe(innerPayload)}.fakesig`;
            const fakeJweString = JSON.stringify({ jws: compactJws });

            const jobRequest = await devKmsService.decodeJobRequest(fakeJweString);

            expect(jobRequest).toBeInstanceOf(Object);
            expect(jobRequest.input).toEqual(innerPayload);
            expect(jobRequest.meta?.jws?.protected).toEqual(innerProtected);
        });
    });

    describe('encodeResponse', () => {
        it('should return a stringified JSON object containing the payload', async () => {
            const payload = { success: true };
            const response = await devKmsService.encodeResponse(payload, [], 'sender-id');

            expect(typeof response).toBe('string');
            const parsed = JSON.parse(response);
            expect(parsed.payload).toEqual(payload);
            expect(parsed.protected).toBeDefined();
        });
    });

    describe('protectConfidentialData', () => {
        it('should move the "content" property into a simulated "jwe" property', async () => {
            const originalContent = { sensitive: 'data' };
            const doc: ConfidentialStorageDoc = { id: 'doc1', content: originalContent, sequence: 0 };
            const protectedDoc = await devKmsService.protectConfidentialData(doc, 'tenant-123');

            expect(protectedDoc.content).toBeUndefined();
            expect(protectedDoc.jwe).toBeDefined();
            expect((protectedDoc.jwe as any).content).toEqual(originalContent);
        });
    });

    describe('unprotectConfidentialData', () => {
        it('should retrieve the original content from the simulated "jwe" property', async () => {
            const originalContent = { sensitive: 'data' };
            const protectedDoc: ConfidentialStorageDoc = { id: 'doc1', jwe: { content: originalContent }, sequence: 0 };
            
            const result = await devKmsService.unprotectConfidentialData<typeof originalContent>(protectedDoc, 'tenant-123');
            
            expect(result).toEqual(originalContent);
        });

        it('should throw if jwe is invalid', async () => {
            const invalidDoc: ConfidentialStorageDoc = { id: 'doc1', jwe: { some: 'field' }, sequence: 0 };
            await expect(devKmsService.unprotectConfidentialData(invalidDoc, 'tenant-123')).rejects.toThrow();
        });
    });
});
