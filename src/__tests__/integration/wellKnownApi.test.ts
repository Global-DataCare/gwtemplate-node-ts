// src/__tests__/integration/wellKnownApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import request from 'supertest';
import { createDiscoveryRouter } from '../../routes/discovery';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { DiscoveryService } from '../../services/DiscoveryService';
import { testTenant1AlternateName, testTenant1DidWebHosted, testTenant1IdentifierUrn, testTenant1VaultId } from '../data/organization.data';
import { DidDocument } from '../../models/did';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from '../../models/schemaorg';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { parseTenantUrn } from '../../utils/urn';

jest.mock('../../managers/TenantsCacheManager');

const mockTenantsCacheManager = new TenantsCacheManager(
  {} as any,
  {} as any,
  'test-host-collection',
) as jest.Mocked<TenantsCacheManager>;

// Create a fully typed mock of the IKmsService to satisfy the interface
const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(),
  provisionKeys: jest.fn(),
  getPublicJwks: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHostPublicJwkSet: jest.fn(),
  decodeJobRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(),
  unprotectConfidentialData: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const app = express();
const discoveryService = new DiscoveryService(mockTenantsCacheManager);
// Pass the mocked kmsService to the router
const discoveryRouter = createDiscoveryRouter(mockTenantsCacheManager, discoveryService, mockKmsService);
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
      service: [{ // This is the new assertion
        id: '#legal-participant-credential',
        type: 'gx:LegalParticipant',
        serviceEndpoint: `${testTenant1DidWebHosted}/.well-known/legal-participant.vc.json`
      }]
    };

    // Configure the mock: The `resolveTenant` middleware will call `getDidDocument` to find the tenant.
    // The final route handler will then call it again via the discoveryService to get the document.
    mockTenantsCacheManager.getDidDocument.mockResolvedValue(expectedDidDoc);

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

describe('Well-Known JWKS Discovery API', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the JWKSet for the host', async () => {
    // --- Arrange ---
    const expectedJwks = { keys: [{ kid: 'host-key-1', kty: 'AKP' }] };
    const expectedUrl = '/host/.well-known/jwks.json';

    // Mock the KMS service directly
    mockKmsService.getPublicJwks.mockResolvedValue(expectedJwks);
    
    // The middleware still needs to resolve the host.
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);

    // --- Act ---
    const response = await request(app).get(expectedUrl);

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual(expectedJwks);
    expect(mockKmsService.getPublicJwks).toHaveBeenCalledWith('host');
  });

  it('should return the JWKSet for a hosted tenant', async () => {
    // --- Arrange ---
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/jwks.json`;
    const expectedJwks = { keys: [{ kid: 'tenant-key-1', kty: 'AKP' }] };

    mockKmsService.getPublicJwks.mockResolvedValue(expectedJwks);
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);

    // --- Act ---
    const response = await request(app).get(expectedUrl);

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedJwks);
    expect(mockKmsService.getPublicJwks).toHaveBeenCalledWith(testTenant1VaultId);
  });
});

describe('Well-Known Legal Participant VC API', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return a signed Legal Participant VC for the host', async () => {
    // --- Arrange ---
    const hostClaims = {
      [ClaimsOrganizationSchemaorg.legalName]: 'Test Host',
      [ClaimsOrganizationSchemaorg.identifierValue]: 'VAT123456',
      [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
      [ClaimsServiceSchemaorg.termsOfService]: 'http://example.com/terms',
      'org.schema.Service.termsOfService#hash': 'somehash',
    };
    const hostDidDoc = { 
      id: 'did:web:host',
      // This is the critical missing piece. The handler needs this to find the signing key.
      assertionMethod: ['did:web:host#key-pqc-sig-1'], 
    };
    const hostEntityConfig = { claims: hostClaims, didDocument: hostDidDoc, hostExternalDomain: 'host.com' };

    mockTenantsCacheManager.getTenant.mockResolvedValue(hostEntityConfig);
    mockTenantsCacheManager.getDidDocument.mockResolvedValue(hostDidDoc as any); // For middleware

    // Mock the signing method from the real KMS service
    mockKmsService.signWithManagedKey.mockResolvedValue({
      payload: 'dummyPayload',
      signatures: [{ protected: 'dummyProtected', signature: 'dummySignature' }],
    });

    // --- Act ---
    const response = await request(app).get('/host/.well-known/legal-participant.vc.json');

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(Object);
    expect(response.body.type).toContain('gx:LegalParticipant');
    expect(response.body.issuer).toBe('did:web:host');
    expect(response.body.credentialSubject.id).toBe('did:web:host');
    
    // Check for the presence of a valid-looking proof
    expect(response.body.proof).toBeDefined();
    expect(response.body.proof.type).toBe('JsonWebSignature2020');
    expect(response.body.proof.proofValue).toContain('dummySignature');
    
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith('host');
    expect(mockKmsService.signWithManagedKey).toHaveBeenCalled();
  });
});

