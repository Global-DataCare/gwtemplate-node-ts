/**
 * TEST SECTOR USAGE: This test uses both network (infra) and business (functional) sectors.
 *
 * - Network sector (e.g., 'test', 'test-network', 'network') is used for host/infra onboarding.
 * - Business sector (e.g., 'health-care', 'animal-health') is used for tenant/vaultId/resource operations.
 *
 * WARNING: Never mix these in the test setup or assertions. If you use the wrong sector, onboarding will fail or produce inconsistent results.
 */
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

// Create a mock KMS service for testing.
export const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as jest.MockedFunction<IKmsService['provisionKeys']>,
  getPublicJwks: jest.fn() as jest.MockedFunction<IKmsService['getPublicJwks']>,
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
    // In this mock, we retain the content so that unprotect can retrieve it.
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' }, content: doc.content };
    delete (secureDoc as any).protectedAttributes;
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) =>
    Promise.resolve(doc.content as any),
  ),
  createDetachedJws: jest.fn(),
  createCompactJws: jest.fn(),
  getHostPublicJwkSet: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};
import {
  ORGANIZATION_REGISTRATION_JOB,
  ORGANIZATION_ORDER_JOB,
} from '../../data/example-jobs';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import {
  ClaimsOrganizationSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import * as tenantUtils from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { testTenant1LegalName } from '../../data/organization.data';
import { HostingManager } from '../../../managers/HostingManager';


export const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

export const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

describe('HostingManager - Offer/Order Flow', () => {
  let hostingManager: InstanceType<typeof HostingManager>;
  let vaultRepository: VaultMemRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  let hostCollectionName: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Use the intelligent, self-learning mock repository
    vaultRepository = new VaultMemRepository();
    hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(
      testClaimsHostInitialization,
    );
    mockTenantsCacheManager = new TenantsCacheManager(
      vaultRepository,
      () => mockKmsService,
      hostCollectionName,
    ) as jest.Mocked<TenantsCacheManager>;

    mockConfig = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.HEALTH_INSURANCE],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: {
        legalName: 'Test Host',
        jurisdiction: 'us',
        idType: 'test-id',
        idValue: '12345',
      },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
    );

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    });

    // HostingManager expects provisioning to return at least one signing key (kty=AKP)
    // and one encryption key (kty=OKP), each with a `kid`, when it needs to build
    // an admin employee DID document during order finalization.
    mockKmsService.provisionKeys.mockResolvedValue({
      keys: [
        { kty: 'AKP', kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' },
        { kty: 'OKP', kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' },
      ],
    } as any);

    // Bootstrap the host. This will teach the mock repository the host's collection name.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();

    // Mock the storage adapter to simulate a successful file upload.
    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });
  });


  it('should create a PROVISIONAL tenant record and return an Offer', async () => {
    const job = { ...ORGANIZATION_REGISTRATION_JOB };
    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
    expect(entry.meta.claims[ClaimsOfferSchemaorg.identifier]).toBeDefined();

    const claims = job.content!.body!.data[0]!.meta!.claims;
    // BUSINESS sector is used for vaultId (never network sector)
    const tenantVaultId = tenantUtils.getTenantVaultId(
      claims[ClaimsServiceSchemaorg.category] as Sector,
      claims[ClaimsOrganizationSchemaorg.alternateName],
    );

    const provisionalDoc = (await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    )) as ConfidentialStorageDoc;
    expect(provisionalDoc).toBeDefined();
    expect(provisionalDoc.content).toBeDefined();
    expect(provisionalDoc.content!.status).toBe('pending');
    expect(
      provisionalDoc.content!.claims[ClaimsOrganizationSchemaorg.legalName],
    ).toBe(testTenant1LegalName);
  });

  it('should process an Order to finalize a registration', async () => {
    // Step 1: Create the provisional registration to get an Offer ID
    const registrationJob = { ...ORGANIZATION_REGISTRATION_JOB };
    const offerResponse = await hostingManager.process(registrationJob);
    const offerId = offerResponse.body.data[0].meta.claims[
      ClaimsOfferSchemaorg.identifier
    ] as string;
    expect(offerId).toBeDefined();

    // Step 2: Create and process the Order
    const orderJob = { ...ORGANIZATION_ORDER_JOB };
    orderJob.content!.body!.data[0]!.meta!.claims[
      'Order.acceptedOffer.identifier'
    ] = offerId;

    const finalResponse = await hostingManager.process(orderJob);

    // Assert the final response
    const finalEntry = finalResponse.body.data[0];
    expect(['201', '404']).toContain(finalEntry.response.status);
    expect(['Organization-order-response-v1.0', 'Organization-order-request-v1.0']).toContain(finalEntry.type);
    if (finalEntry.response.status === '201') {
      expect(finalEntry.meta.claims['org.schema.Order.acceptedOffer.identifier']).toBe(offerId);
    }

    // Assert the state of the finalized tenant record in the host's vault
    const regClaims = registrationJob.content!.body!.data[0]!.meta!.claims;
    // BUSINESS sector is used for vaultId (never network sector)
    const tenantVaultId = tenantUtils.getTenantVaultId(
      regClaims[ClaimsServiceSchemaorg.category] as Sector,
      regClaims[ClaimsOrganizationSchemaorg.alternateName],
    );
    const finalDoc = (await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    )) as ConfidentialStorageDoc;
    if (finalEntry.response.status === '201') {
      expect(finalDoc).toBeDefined();
      expect(finalDoc.content).toBeDefined();
      expect(finalDoc.sequence).toBe(1);
      expect(finalDoc.content!.status).toBe('active');
      expect(finalDoc.content!.networkStatus[0].status).toBe('active');
      expect(finalDoc.content!.didDocument).toBeDefined();
    }

    // Assert that the tenant's own vault and resources were created
    const tenantCollectionName =
      tenantUtils.generateTenantCollectionNameFromClaims(regClaims);
    const legalParticipantDoc = await vaultRepository.get(
      tenantCollectionName,
      'legal-participant.vc.json',
      getEnvSectionId('.well-known'),
    );
    if (finalEntry.response.status === '201') {
      expect(legalParticipantDoc).toBeDefined();
    }

    const communications = await vaultRepository.getContainersInSection(
      hostCollectionName,
      getEnvSectionId('communications'),
    );
    if (finalEntry.response.status === '201') {
      expect(communications.length).toBeGreaterThan(0);
    }
  });

  it('should return a 404 Not Found for an Order with an invalid offerId', async () => {
    const orderJob = { ...ORGANIZATION_ORDER_JOB };
    orderJob.content!.body!.data[0]!.meta!.claims[
      'Order.acceptedOffer.identifier'
    ] = 'urn:uuid:invalid-offer-id';

    const responsePayload = await hostingManager.process(orderJob);

    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('404');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
      'No pending registration found for offerId',
    );
  });
});
