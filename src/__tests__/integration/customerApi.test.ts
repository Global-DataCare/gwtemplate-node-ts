// src/__tests__/integration/customerApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * @file Integration test for the Asynchronous Customer Onboarding API Endpoint.
 *
 * @architecture
 * This test focuses ONLY on the API Controller layer (the router). Its sole responsibilities are:
 * 1.  Receive an encrypted request.
 * 2.  Call `kmsService.decodeRequest` to decrypt and decode the job.
 * 3.  Pass the decoded job to the `queueAdapter.addJob`.
 * 4.  Return an HTTP 202 Accepted response with the correct Location header.
 *
 * This test MUST NOT test the manager's business logic.
 *
 * @pattern
 * 1.  **Arrange**:
 *     - Mock `kmsService.decodeRequest` to resolve with a canonical, IMPORTED job fixture
 *       (e.g., `ORGANIZATION_REGISTRATION_JOB` from `example-jobs.ts`). DO NOT build mock jobs by hand.
 *     - Spy on `queueAdapter.addJob`.
 * 2.  **Act**:
 *     - Make a single `request` call to the endpoint with a dummy encrypted payload.
 * 3.  **Assert**:
 *     - `kmsService.decodeRequest` was called.
 *     - `queueAdapter.addJob` was called ONCE with the EXACT job fixture from the Arrange step.
 *     - The HTTP response is 202 Accepted.
 *     - The `Location` header is correct.
 */

import express from 'express';
import { createApiRouter } from '../../routes/api';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { QueueAdapter } from '../../adapters/queue';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
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
  );
  app.use('/', apiRouter);

  return { app, tenantsCacheManager };
};

describe('Person Onboarding API', () => {
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
    const section = 'individual';
    const format = 'org.schema';
    const resourceType = 'Person';
    const action = '_batch';

    const registrationUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
    const expectedPollingUrl = `http://localhost:3001${registrationUrl.replace('/_batch', '/_batch-response')}`;

    const mockTenantServices: DidService[] = [
      {
        id: `#${section}:${format}`,
        type: 'IndividualOnboardingService',
        serviceEndpoint: resourceType,
        actions: [action],
        selector: { section, format },
      },
    ];
    jest.spyOn(tenantsCacheManager, 'getDidServiceConfig').mockResolvedValue(mockTenantServices);

    // Mock decodeRequest to return a canonical, imported job fixture.
    const mockJob = { ...ORGANIZATION_REGISTRATION_JOB }; // Use a valid job as a template
    mockKmsService.decodeRequest.mockResolvedValue(mockJob);

    // --- Act ---
    const response = await invokeExpress(app, {
      method: 'POST',
      url: registrationUrl,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { request: testEncryptedJwe1 },
    });

    // --- Assert ---
    expect(mockKmsService.decodeRequest).toHaveBeenCalledWith(testEncryptedJwe1);
    expect(mockQueueAdapter.addJob).toHaveBeenCalledTimes(1);
    const [jobName, queuedJob] = (mockQueueAdapter.addJob as jest.Mock).mock.calls[0];
    expect(jobName).toContain('health-care_acme:Person:_batch');
    expect(queuedJob.tenantId).toBe(tenantId);
    expect(queuedJob.sector).toBe(sector);
    expect(queuedJob.section).toBe(section);
    expect(queuedJob.format).toBe(format);
    expect(queuedJob.resourceType).toBe(resourceType);
    expect(queuedJob.action).toBe(action);
    // The API layer should preserve the decrypted payload content.
    expect(queuedJob.content).toEqual(mockJob.content);
    expect(response.status).toBe(202);
    expect(response.headers.location).toBe(expectedPollingUrl);
  });
});
