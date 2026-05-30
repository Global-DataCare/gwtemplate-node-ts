// src/__tests__/integration/wellKnownApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { jest } from '@jest/globals';
import express from 'express';
import { createDiscoveryRouter } from '../../routes/discovery';
import { DiscoveryService } from '../../services/DiscoveryService';
import type { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testTenant1AlternateName, testTenant1DidWebHosted, testTenant1IdentifierUrn, testTenant1VaultId } from '../data/organization.data';
import { DidDocument } from '../../gdc-backend-utils-node/models/did';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { parseTenantUrn } from '../../utils/urn';
import { ILogger } from '../../loggers/ILogger';
import { invokeExpress } from './helpers/invokeExpress';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import { ServiceCapabilityToken, serializeServiceCapabilityTokens } from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  buildExampleHostedTenantBaseUrl,
  EXAMPLE_COVERAGE_SCOPE_EU,
  EXAMPLE_GATEWAY_PUBLIC_ORIGIN,
  EXAMPLE_HOSTING_OPERATOR_DID,
  EXAMPLE_HOST_PUBLIC_HOSTNAME,
  EXAMPLE_PROVIDER_LEGAL_NAME,
  EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
  EXAMPLE_SECONDARY_PROVIDER_LEGAL_NAME,
  EXAMPLE_SECONDARY_TENANT_SERVICE_DID,
} from 'gdc-common-utils-ts/examples/shared';

const mockTenantsCacheManager = {
  getDidDocument: jest.fn(),
  getTenant: jest.fn(),
  getTenantDomainUrl: jest.fn(async () => 'https://host.example.com'),
  listAutodiscoverableTenants: jest.fn(),
  listRegisteredTenants: jest.fn(),
} as unknown as jest.Mocked<TenantsCacheManager>;

// Create a fully typed mock of the IKmsService to satisfy the interface
const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(),
  provisionKeys: jest.fn(),
  getPublicJwks: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHostPublicJwkSet: jest.fn(),
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  createDetachedJws: jest.fn(),
  createCompactJws: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => doc.content as any),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as jest.Mocked<ILogger>;

const app = express();
const discoveryService = new DiscoveryService(mockTenantsCacheManager);
// Pass the mocked kmsService and logger to the router
const discoveryRouter = createDiscoveryRouter(mockTenantsCacheManager, discoveryService, mockKmsService, mockLogger);
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
    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.text)).toEqual(expectedDidDoc);
    
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
    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.text)).toEqual(expectedJwks);
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
    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedJwks);
    expect(mockKmsService.getPublicJwks).toHaveBeenCalledWith(testTenant1VaultId);
  });
});

describe('Well-Known Tenant Artifacts API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the stored legal participant VC (legal-participant.vc.json) for a hosted tenant', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/legal-participant.vc.json`;

    const expectedVc = { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: 'did:web:host' };
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({ governanceVc: expectedVc } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedVc);
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('should return the stored legal participant VC via the legacy vc.json alias', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/vc.json`;

    const expectedVc = { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: 'did:web:host' };
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({ governanceVc: expectedVc } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedVc);
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('should return the stored self-description (self-description.json) for a hosted tenant', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/self-description.json`;

    const expectedSelfDesc = { type: ['VerifiableCredential'], credentialSubject: { id: testTenant1IdentifierUrn } };
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({ selfDescriptionVc: expectedSelfDesc } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedSelfDesc);
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('should return the index service offering artifact for a hosted tenant when indexing is enabled', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/service-offering-index.json`;

    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: testTenant1IdentifierUrn },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: urnParts.sector,
        [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
          alternateName: tenantId,
          jurisdiction: urnParts.jurisdiction,
          version: urnParts.version,
          sector: urnParts.sector,
        }),
        [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
          ServiceCapabilityToken.IndexProvider,
          ServiceCapabilityToken.IndexReader,
        ]),
      },
    } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed['@type']).toBe('dcat:DataService');
    expect(parsed['dcat:endpointURL']).toBe(buildExampleHostedTenantBaseUrl({
      alternateName: tenantId,
      jurisdiction: urnParts.jurisdiction,
      version: urnParts.version,
      sector: urnParts.sector,
    }));
    expect(parsed['dcat:keyword']).toEqual([ServiceCapabilityToken.IndexProvider]);
  });

  it('should return 404 for the research service offering artifact when digital twin is not enabled', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/service-offering-research.json`;

    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: testTenant1IdentifierUrn },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: urnParts.sector,
        [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
          alternateName: tenantId,
          jurisdiction: urnParts.jurisdiction,
          version: urnParts.version,
          sector: urnParts.sector,
        }),
        [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
          ServiceCapabilityToken.IndexProvider,
          ServiceCapabilityToken.IndexReader,
        ]),
      },
    } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    expect(response.status).toBe(404);
  });
});

describe('Well-Known Legal Participant VC API', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the stored Legal Participant VC for the host', async () => {
    const hostDidDoc = { id: 'did:web:host' };
    const hostEntityConfig = {
      didDocument: hostDidDoc,
      governanceVc: { id: 'urn:uuid:host-legal-participant', issuer: 'did:web:host' },
    };

    mockTenantsCacheManager.getTenant.mockResolvedValue(hostEntityConfig);
    mockTenantsCacheManager.getDidDocument.mockResolvedValue(hostDidDoc as any);

    const response = await invokeExpress(app, { method: 'GET', url: '/host/.well-known/legal-participant.vc.json' });

    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.text);
    expect(parsed).toEqual(hostEntityConfig.governanceVc);
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith('host');
  });
});

describe('DCAT3 Discovery API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return a catalog artifact with dcat:service entries derived from serviceType capabilities', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);
    mockTenantsCacheManager.listAutodiscoverableTenants.mockResolvedValue([
      {
        didDocument: { id: testTenant1DidWebHosted },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: testTenant1AlternateName,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapabilityToken.IndexProvider,
            ServiceCapabilityToken.DigitalTwinProvider,
          ]),
        },
      },
      {
        didDocument: { id: EXAMPLE_SECONDARY_TENANT_SERVICE_DID },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_SECONDARY_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapabilityToken.IndexReader,
            ServiceCapabilityToken.DigitalTwinReader,
          ]),
        },
      },
    ] as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: '/.well-known/dcat3/catalog',
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME },
    });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed['@type']).toBe('dcat:Catalog');
    expect(Array.isArray(parsed['dcat:service'])).toBe(true);
    expect(parsed['dcat:service']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-index.json`,
          '@type': 'dcat:DataService',
        }),
        expect.objectContaining({
          '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-research.json`,
          '@type': 'dcat:DataService',
        }),
      ]),
    );
    expect(parsed['dcat:dataset'][0]['dcat:service']).toEqual(
      expect.arrayContaining([
        { '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-index.json` },
        { '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-research.json` },
      ]),
    );
    expect(parsed['dcat:dataset']).toHaveLength(1);
    expect(mockTenantsCacheManager.listAutodiscoverableTenants).toHaveBeenCalledTimes(1);
  });

  it('should return normalized published-provider discovery DTOs for backend consumers', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: EXAMPLE_HOSTING_OPERATOR_DID } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: EXAMPLE_HOSTING_OPERATOR_DID },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: 'Host Operator Example',
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
        [ClaimsServiceSchemaorg.areaServed]: `ES,${EXAMPLE_COVERAGE_SCOPE_EU}`,
      },
    } as any);
    mockTenantsCacheManager.listAutodiscoverableTenants.mockResolvedValue([
      {
        didDocument: { id: testTenant1DidWebHosted },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: testTenant1AlternateName,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapabilityToken.IndexProvider,
            ServiceCapabilityToken.DigitalTwinProvider,
          ]),
        },
      },
      {
        didDocument: { id: EXAMPLE_SECONDARY_TENANT_SERVICE_DID },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_SECONDARY_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapabilityToken.IndexReader,
            ServiceCapabilityToken.DigitalTwinReader,
          ]),
        },
      },
    ] as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url: '/api/dataspace-discovery/providers',
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME, 'content-type': 'application/json' },
      body: {
        sector: DataspaceSectors.HealthResearch,
        providerCapability: ServiceCapabilityToken.IndexProvider,
        jurisdiction: 'ES',
        coverageScope: EXAMPLE_COVERAGE_SCOPE_EU,
      },
    });

    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(Array.isArray(parsed.providers)).toBe(true);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0]).toEqual(
      expect.objectContaining({
        providerDid: testTenant1DidWebHosted,
        hostingOperatorDid: EXAMPLE_HOSTING_OPERATOR_DID,
        title: EXAMPLE_PROVIDER_LEGAL_NAME,
      }),
    );
    expect(parsed.providers[0].record).toEqual(
      expect.objectContaining({
        providerDid: testTenant1DidWebHosted,
        serviceType: ServiceCapabilityToken.IndexProvider,
        category: DataspaceSectors.HealthResearch,
        areaServed: 'ES',
      }),
    );
    expect(parsed.hostingOperators).toEqual([
      expect.objectContaining({
        operatorDid: EXAMPLE_HOSTING_OPERATOR_DID,
        matchedCapabilities: [ServiceCapabilityToken.IndexProvider],
      }),
    ]);
    expect(parsed.hostingOperators[0].record).toEqual(
      expect.objectContaining({
        subjectId: EXAMPLE_HOSTING_OPERATOR_DID,
        coverageScope: EXAMPLE_COVERAGE_SCOPE_EU,
      }),
    );
  });
});
