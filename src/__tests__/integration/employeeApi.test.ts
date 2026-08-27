// TDD contract: write this test red first; make it green only with the complete real behavior.
// src/__tests__/integration/employeeApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * @file Integration test for the Asynchronous Employee Onboarding API Endpoint.
 *
 * @architecture See customerApi.test.ts for a detailed explanation of the canonical pattern.
 * This test follows the same simple, focused pattern.
 */

import express from 'express';
import { createApiRouter } from '../../routes/api';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { mockKmsService } from '../mocks/kms.mock';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { AsyncResponseStoreMem, IAsyncResponseStore } from '../../adapters/async-response-store.mem';
import { DidService } from '../../gdc-backend-utils-node/models/did';
import { testTenant1AlternateName, testTenant1AddressCountry } from '../data/organization.data';
import { ORGANIZATION_REGISTRATION_JOB } from '../data/example-jobs'; // Using a canonical job fixture
import { invokeExpress } from './helpers/invokeExpress';
import { AdapterCryptoSdkNode } from '../../gdc-backend-utils-node/adapters/node/crypto';

// --- Mock Dependencies ---
const mockQueueAdapter: jest.Mocked<QueueAdapter> = {
  addJob: jest.fn(),
};
const mockAppAuthManager = {
  verifyBearerToken: jest.fn(async () => ({ payload: { sub: 'employee-api-test' } })),
} as any;

const setupApp = (asyncResponseStore: IAsyncResponseStore) => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const vaultRepository = new VaultMemRepository();
  const tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, 'test-host-collection');
  const cryptographyService = new CryptographyService(new AdapterCryptoSdkNode());

  const apiRouter = createApiRouter(
    mockQueueAdapter,
    tenantsCacheManager,
    mockKmsService,
    asyncResponseStore,
    vaultRepository,
    cryptographyService,
    'http://localhost:3001',
    mockAppAuthManager,
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Employee Onboarding API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should decode the request, queue a job, and return 202 Accepted', async () => {
    // --- Arrange ---
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const sector = 'health-care';
    const section = 'entity';
    const format = 'org.schema';
    const resourceType = 'Employee';
    const action = '_batch';

    const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
    const expectedPollingUrl = `http://localhost:3001${registrationUrl.replace('/_batch', '/_batch-response')}`;

    const mockTenantServices: DidService[] = [
      {
        id: `#${section}:${format}`,
        type: 'EmployeeOnboardingService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      },
    ];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(mockTenantServices);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({
      didConfig: { service: mockTenantServices },
    } as any);

    // Mock decodeRequest to return a canonical, imported job fixture.
    const mockJob = { ...ORGANIZATION_REGISTRATION_JOB }; // Use a valid job as a template
    mockKmsService.decodeRequest.mockResolvedValue(mockJob);

    // --- Act ---
    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    // --- Assert ---
    expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(testEncryptedJwe1);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    const [jobName, queuedJob] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
    expect(jobName).toContain(`health-care_${tenantId}:Employee:_batch`);
    expect(queuedJob.tenantId).toBe(tenantId);
    expect(queuedJob.sector).toBe(sector);
    expect(queuedJob.section).toBe(section);
    expect(queuedJob.format).toBe(format);
    expect(queuedJob.resourceType).toBe(resourceType);
    expect(queuedJob.action).toBe(action);
    expect(queuedJob.content).toEqual(mockJob.content);
    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(expectedPollingUrl);
  });

  it('should accept Employee/_search and return the async polling URL', async () => {
    const asyncResponseStore = new AsyncResponseStoreMem();
    const { app, tenantsCacheManager } = setupApp(asyncResponseStore);

    const tenantId = testTenant1AlternateName;
    const jurisdiction = testTenant1AddressCountry.toLowerCase();
    const sector = 'health-care';
    const section = 'entity';
    const format = 'org.schema';
    const resourceType = 'Employee';
    const action = '_search';

    const searchUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
    const expectedPollingUrl = `http://localhost:3001${searchUrl}-response`;

    const mockTenantServices: DidService[] = [
      {
        id: `#${section}:${format}:employee-search`,
        type: 'EmployeeDirectoryService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      },
    ];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(mockTenantServices);
    jest.spyOn(tenantsCacheManager, 'getTenant').mockResolvedValue({
      didConfig: { service: mockTenantServices },
    } as any);

    const mockJob = { ...ORGANIZATION_REGISTRATION_JOB };
    mockKmsService.decodeRequest.mockResolvedValue(mockJob);

    const response = await invokeExpress(app, {
      method: 'POST',
      url: searchUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer test-id-token' },
      body: { request: testEncryptedJwe1 },
    });

    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    const [, queuedJob] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
    expect(queuedJob.resourceType).toBe(resourceType);
    expect(queuedJob.action).toBe(action);
    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(expectedPollingUrl);
  });
});
