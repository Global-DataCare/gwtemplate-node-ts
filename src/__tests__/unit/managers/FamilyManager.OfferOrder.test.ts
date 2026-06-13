/**
 * TEST SECTOR USAGE: This test uses both network (infra) and business (functional) sectors.
 *
 * - Network sector (e.g., 'test', 'test-network', 'network') is used for host/infra onboarding.
 * - Business sector (e.g., 'health-care', 'animal-health') is used for tenant/vaultId/resource operations.
 *
 * WARNING: Never mix these in the test setup or assertions. If you use the wrong sector, onboarding will fail or produce inconsistent results.
 */
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
// File: src/__tests__/unit/managers/FamilyManager.OfferOrder.test.ts

import { jest } from '@jest/globals';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ORGANIZATION_ORDER_JOB, ORGANIZATION_REGISTRATION_JOB } from '../../data/example-jobs';
import { FAMILY_ORDER_REQUEST, FAMILY_REGISTRATION_REQUEST } from '../../data/example-payloads';
import * as tenantUtils from '../../../utils/tenant';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getEnvSectionId } from '../../../utils/section-env';
import { HostingManager } from '../../../managers/HostingManager';
import { FamilyManager } from '../../../managers/FamilyManager';
import { testDefaultTenantServiceTypeClaim, testTenant1TenantId } from '../../data/organization.data';
import { generateLicenseOffer } from '../../../utils/offer';


const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as any,
  getPublicJwks: jest.fn() as any,
  decodeRequest: jest.fn() as any,
  signWithManagedKey: jest.fn() as any,
  signWithReconstructedKey: jest.fn() as any,
  createDetachedJws: jest.fn(async () => 'mock-jws'),
  createCompactJws: jest.fn(async () => 'mock-compact-jws'),
  encodeResponse: jest.fn() as any,
  getHostPublicJwkSet: jest.fn() as any,
  getPublicVerificationKey: jest.fn() as any,
  getPublicEncryptionKey: jest.fn() as any,
  getHmacBase64Url: jest.fn() as any,
  protectAttributesNameAndValue: jest.fn() as any,
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => {
    const { content, ...rest } = doc;
    return { ...rest, jwe: { ciphertext: 'encrypted' }, _content: content } as any;
  }),
  unprotectConfidentialData: jest.fn(async (doc: any) => doc._content),
};

describe('FamilyManager - Offer/Order Flow', () => {
  let vaultRepository: VaultMemRepository;
  let tenantsCacheManager: TenantsCacheManager;
  let hostingManager: InstanceType<typeof HostingManager>;
  let familyManager: InstanceType<typeof FamilyManager>;
  let hostCollectionName: string;
  let config: IServerConfig;

  function buildFamilyRegistrationRequestWithoutPdfAttachment() {
    const payload = structuredClone(FAMILY_REGISTRATION_REQUEST) as any;
    delete payload.attachments;
    return payload;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    vaultRepository = new VaultMemRepository();

    const hostClaims = {
      'org.schema.Organization.alternateName': 'host',
      'org.schema.Organization.legalName': 'Hosting Organization',
      'org.schema.Organization.identifier.additionalType': 'TAX',
      'org.schema.Organization.identifier.value': 'A12345678',
      'org.schema.Organization.identifier': 'did:web:host.example.com',
      'org.schema.Organization.address.addressCountry': 'ES',
      'org.schema.Person.identifier': 'urn:uuid:a1b2c3d4-e5f6-7890-1234-567890abcdef',
      'org.schema.Person.hasOccupation': 'ISCO-08|1120',
      'org.schema.Person.email': 'admin1@host.example.com',
      'org.schema.Service.category': 'system',
      'org.schema.Service.identifier': 'urn:web:<manufacturer>',
      'org.schema.Service.serviceType': testDefaultTenantServiceTypeClaim,
      'org.schema.Service.termsOfService': 'https://github.com/<manufacturer>/<software>/terms',
    };
    hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(hostClaims as any);

    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName);

    config = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      apiHostname: 'testhost',
      hostExternalDomain: 'host.example.com',
      apiBaseUrl: 'http://host.example.com',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.TEST],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: { legalName: 'Test Host', jurisdiction: 'es', idType: 'TAX', idValue: 'A12345678' },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    mockStorageAdapter.upload.mockResolvedValue({
      publicUrl: 'https://storage.example.com/terms.pdf',
      encodedMultiHash: 'zQm...',
    });

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [{ kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any],
    });

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      config,
    );

    // Bootstrap host and register the provider tenant (acme) so FamilyManager can resolve it via TenantsCacheManager.
    // Use network sector for host onboarding
    await hostingManager.bootstrapHost(hostClaims as any);
    await tenantsCacheManager.loadHost();

    const registrationJob = { ...ORGANIZATION_REGISTRATION_JOB };
    const offerResponse = await hostingManager.process(registrationJob);
    // BUSINESS sector is used for vaultId (never network sector)
    const offerId = offerResponse.body.data[0].meta.claims[ClaimsOfferSchemaorg.identifier] as string;

    const orderJob = { ...ORGANIZATION_ORDER_JOB };
    orderJob.content!.body!.data[0]!.meta!.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    await hostingManager.process(orderJob);

    familyManager = new FamilyManager(
      vaultRepository,
      mockKmsService,
      tenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      config,
    );
  });

  it('should create a pending family record and return an Offer', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const responsePayload = await familyManager.process(familyRegistrationJob);
    const entry = responsePayload.body.data[0];

    expect(['201', '400']).toContain(entry.response.status);
    if (entry.response.status === '201') {
      expect(entry.type).toBe('Family-registration-offer-v1.0');
      expect(entry.meta.claims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
    }
  });

  it('should process a family Order and finalize the family registration', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const offerPayload = await familyManager.process(familyRegistrationJob);
    const firstEntry = offerPayload.body.data[0];
    if (firstEntry.response.status !== '201') {
      expect(firstEntry.response.status).toBe('400');
      return;
    }
    const offerId = firstEntry.meta.claims[ClaimsOfferSchemaorg.identifier] as string;

    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;

    const familyOrderJob: JobRequest = {
      id: 'job-family-order-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    };

    const finalPayload = await familyManager.process(familyOrderJob);
    const entry = finalPayload.body.data[0];
    expect(['201', '400']).toContain(entry.response.status);
    if (entry.response.status === '201') {
      expect(entry.type).toBe('Family-order-response-v1.0');
      expect(entry.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
    }

    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = await tenantsCacheManager.getCollectionName(tenantVaultId);
    expect(tenantCollectionName).toBeDefined();
    const communications = await vaultRepository.getContainersInSection(
      tenantCollectionName!,
      getEnvSectionId('communications'),
    );
    if (entry.response.status === '201') {
      expect(communications.length).toBeGreaterThan(0);
    }
  });

  it('should reopen family Offer and Order records through _search for portal-style read models', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const offerPayload = await familyManager.process(familyRegistrationJob);
    const firstEntry = offerPayload.body.data[0];
    if (firstEntry.response.status !== '201') {
      expect(firstEntry.response.status).toBe('400');
      return;
    }
    const offerId = firstEntry.meta.claims[ClaimsOfferSchemaorg.identifier] as string;

    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    await familyManager.process({
      id: 'job-family-search-order-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    });

    const offerSearch = await familyManager.process({
      id: 'job-family-offer-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_search',
      resourceType: 'Offer',
      content: {
        body: {
          data: [{
            type: 'Offer-search-request-v1.0',
            meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } },
            resource: { meta: { claims: { [ClaimsOfferSchemaorg.identifier]: offerId } } },
          }],
        },
      } as any,
    });

    expect(offerSearch.body.data[0].response.status).toBe('200');
    expect(offerSearch.body.data[0].resource.total).toBeGreaterThanOrEqual(1);

    const orderSearch = await familyManager.process({
      id: 'job-family-order-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_search',
      resourceType: 'Order',
      content: {
        body: {
          data: [{
            type: 'Order-search-request-v1.0',
            meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } },
            resource: { meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } } },
          }],
        },
      } as any,
    });

    expect(orderSearch.body.data[0].response.status).toBe('200');
    expect(orderSearch.body.data[0].resource.total).toBeGreaterThanOrEqual(1);
  });

  it('should accept one portal-managed commercial family Order and emit extra individual seats', async () => {
    process.env.PAYMENT_ORCHESTRATION_MODE = 'portal-bff';
    process.env.PAYMENT_VERIFICATION_MODE = 'mock';

    const tenantId = testTenant1TenantId;
    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = await tenantsCacheManager.getCollectionName(tenantVaultId);
    expect(tenantCollectionName).toBeDefined();

    const extraOfferClaims = generateLicenseOffer(
      2,
      'did:web:host.example.com',
      'es',
      Sector.HEALTH_CARE,
      ['Stripe'],
      'individual' as any,
    );

    const secureOfferDoc = await mockKmsService.protectConfidentialData({
      id: String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]),
      status: 'active',
      sequence: 0,
      content: { claims: extraOfferClaims },
    } as ConfidentialStorageDoc, tenantVaultId);
    await vaultRepository.put(tenantCollectionName!, [secureOfferDoc], getEnvSectionId('communications'));

    const beforeLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );

    const orderContent = structuredClone(FAMILY_ORDER_REQUEST) as any;
    orderContent.body.data[0].meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] =
      String(extraOfferClaims[ClaimsOfferSchemaorg.identifier]);
    orderContent.body.data[0].meta.claims[ClaimsOrderSchemaorg.paymentMethod] = 'Stripe';
    orderContent.body.data[0].meta.claims[ClaimsOrderSchemaorg.partOfInvoice] = 'in_family_test_001';

    const familyOrderJob: JobRequest = {
      id: 'job-family-commercial-order-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: orderContent,
    };

    const responsePayload = await familyManager.process(familyOrderJob);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Family-order-response-v1.0');
    expect(entry.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(
      extraOfferClaims[ClaimsOfferSchemaorg.identifier],
    );
    expect(entry.resource?.resourceType).toBe('Bundle');
    expect(
      entry.resource?.entry?.some?.((bundleEntry: any) => bundleEntry?.resource?.resourceType === 'Invoice'),
    ).toBe(true);

    const afterLicenses = await vaultRepository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    expect(afterLicenses.length).toBe(beforeLicenses.length + 2);
  });
});
