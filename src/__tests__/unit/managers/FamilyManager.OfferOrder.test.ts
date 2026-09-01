// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
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
import { FAMILY_ORDER_REQUEST, FAMILY_REGISTRATION_REQUEST } from '../../data/example-payloads';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import * as tenantUtils from '../../../utils/tenant';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { getEnvSectionId } from '../../../utils/section-env';
import { FamilyManager } from '../../../managers/FamilyManager';
import {
  testConfigTenant1,
  testTenant1DidWebExternal,
  testTenant1TenantId,
} from '../../data/organization.data';
import { testClaimsHostInitialization } from '../../data/end-to-end.data';
import { generateLicenseOffer } from '../../../utils/offer';
import { buildOfferOrderIndexedAttributes } from '../../../utils/offer-order-read-model';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import { EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME } from 'gdc-common-utils-ts/examples/shared';


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
  let familyManager: InstanceType<typeof FamilyManager>;
  let hostCollectionName: string;
  let config: IServerConfig;

  function buildFamilyRegistrationRequestWithoutPdfAttachment(addressCountry?: string) {
    const payload = structuredClone(FAMILY_REGISTRATION_REQUEST) as any;
    delete payload.attachments;
    for (const entry of payload.body.data) {
      const claimBlocks = [entry.meta?.claims, entry.resource?.meta?.claims].filter(Boolean);
      for (const claims of claimBlocks) {
        claims[ClaimsOrganizationSchemaorg.alternateName] = EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME;
        if (addressCountry) {
          claims[ClaimsOrganizationSchemaorg.addressCountry] = addressCountry;
        } else {
          delete claims[ClaimsOrganizationSchemaorg.addressCountry];
        }
      }
    }
    return payload;
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    vaultRepository = new VaultMemRepository();

    hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(testClaimsHostInitialization);

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
      maxHeaderSize: 32_768,
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

    // FamilyManager is the unit under test. Seed one verified active tenant
    // directly from the shared organization fixture; HostingManager's own
    // activation/Order lifecycle is covered by route integration tests.
    const expectedTenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, testTenant1TenantId);
    const tenantConfig = structuredClone(testConfigTenant1) as any;
    tenantConfig.claims[ClaimsServiceSchemaorg.category] = Sector.HEALTH_CARE;
    tenantConfig.didDocument = {
      ...(tenantConfig.didDocument || {}),
      id: testTenant1DidWebExternal,
    };
    const secureTenantRecord = await mockKmsService.protectConfidentialData({
      id: expectedTenantVaultId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      content: tenantConfig,
    } as ConfidentialStorageDoc, 'host');
    await vaultRepository.put(
      hostCollectionName,
      [secureTenantRecord],
      getEnvSectionId('tenants'),
    );
    const tenantRecords = await vaultRepository.getContainersInSection(hostCollectionName, getEnvSectionId('tenants'));
    expect(tenantRecords.map((record) => record.id)).toContain(expectedTenantVaultId);
    const cachedTenant = await tenantsCacheManager.refreshTenant(expectedTenantVaultId);
    expect(cachedTenant?.didDocument?.id).toBe(testTenant1DidWebExternal);
    expect(await tenantsCacheManager.getCollectionName(expectedTenantVaultId)).toBe(
      tenantUtils.generateTenantCollectionNameFromClaims(tenantConfig.claims),
    );

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
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const responsePayload = await familyManager.process(familyRegistrationJob);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Family-registration-offer-v1.0');
    expect(entry.meta.claims[ClaimsOfferSchemaorg.identifier]).toMatch(
      /^urn:cds:ES:v1:health-care:product:org\.schema:Offer:/,
    );
    expect(entry.meta.claims[ClaimsOfferSchemaorg.identifier]).not.toContain('undefined');
  });

  it('should process a family Order and finalize the family registration', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const offerPayload = await familyManager.process(familyRegistrationJob);
    const firstEntry = offerPayload.body.data[0];
    expect(firstEntry.response.status).toBe('201');
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
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Family-order-response-v1.0');
    expect(entry.meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);

    const tenantVaultId = tenantUtils.getTenantVaultId(Sector.HEALTH_CARE, tenantId);
    const tenantCollectionName = await tenantsCacheManager.getCollectionName(tenantVaultId);
    expect(tenantCollectionName).toBeDefined();
    const communications = await vaultRepository.getContainersInSection(
      tenantCollectionName!,
      getEnvSectionId('communications'),
    );
    expect(communications.length).toBeGreaterThan(0);
  });

  it('should reopen family Offer and Order records through _search for portal-style read models', async () => {
    const tenantId = testTenant1TenantId;
    const familyRegistrationJob: JobRequest = {
      id: 'job-family-search-1',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId,
      jurisdiction: 'ES',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment(),
    };

    const offerPayload = await familyManager.process(familyRegistrationJob);
    const firstEntry = offerPayload.body.data[0];
    expect(firstEntry.response.status).toBe('201');
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
    expect(extractBundleSearchResources(offerSearch.body).length).toBeGreaterThanOrEqual(1);

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
    expect(extractBundleSearchResources(orderSearch.body).length).toBeGreaterThanOrEqual(1);
  });

  it('uses the route network even when an individual address country conflicts', async () => {
    const response = await familyManager.process({
      id: 'job-family-route-network-wins',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: testTenant1TenantId,
      jurisdiction: 'es',
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment('ZZ'),
    });

    const entry = response.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.meta.claims[ClaimsOfferSchemaorg.identifier]).toMatch(/^urn:cds:ES:v1:health-care:/);
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.addressCountry]).toBe('ZZ');
  });

  it('rejects an individual Offer when the route network is absent even if addressCountry exists', async () => {
    const response = await familyManager.process({
      id: 'job-family-missing-route-network',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: testTenant1TenantId,
      sector: Sector.HEALTH_CARE,
      section: 'individual',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Organization',
      content: buildFamilyRegistrationRequestWithoutPdfAttachment('ES'),
    });

    const entry = response.body.data[0];
    expect(entry.response.status).toBe('400');
    expect(entry.response.outcome.issue[0].diagnostics).toContain('route jurisdiction');
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
      meta: { claims: extraOfferClaims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(extraOfferClaims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
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
