// src/__tests__/integration/wellKnownApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { createDiscoveryRouter } from '../../routes/discovery';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { DiscoveryService } from '../../services/DiscoveryService';
import { testTenant1AlternateName, testTenant1DidWebHosted, testTenant1IdentifierUrn, testTenant1VaultId } from '../data/organization.data';
import { DidDocument } from '../../models/did';
import { parseTenantUrn } from '../../utils/urn';

jest.mock('../../managers/TenantsCacheManager');

const mockTenantsCacheManager = new TenantsCacheManager(
  {} as any,
  {} as any,
) as jest.Mocked<TenantsCacheManager>;

const app = express();
const discoveryService = new DiscoveryService(mockTenantsCacheManager);
const discoveryRouter = createDiscoveryRouter(mockTenantsCacheManager, discoveryService);
app.use('/', discoveryRouter);

describe('Well-Known DID Discovery API', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the correct DID Document for a hosted tenant via the cds-style path', async () => {
    // --- Arrange ---
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;

    // Construct the exact URL the gateway is expected to handle for a hosted DID.
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/did.json`;
    
    const expectedDidDoc: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: testTenant1IdentifierUrn,
      alsoKnownAs: [testTenant1DidWebHosted],
    };

    // Configure the mock: The `resolveTenant` middleware will call `getDidDocument` to find the tenant.
    // The final route handler will then call it again via the discoveryService to get the document.
    mockTenantsCacheManager.getDidDocument.mockReturnValue(expectedDidDoc);

    // --- Act ---
    const response = await request(app).get(expectedUrl);

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(expectedDidDoc);
    
    // Verify the middleware and the service handler used the correctly constructed vaultId to find the tenant.
    expect(mockTenantsCacheManager.getDidDocument).toHaveBeenCalledWith(testTenant1VaultId);
    // It's called twice: once in the middleware to check existence, once in the handler to get the data.
    expect(mockTenantsCacheManager.getDidDocument).toHaveBeenCalledTimes(2);
  });
});
