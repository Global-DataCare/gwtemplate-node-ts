// src/__tests__/integration/fabricEnrollmentApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// Set env var for deterministic keys, as per end-to-end-flow.test.ts
process.env.DEV_SEED = 'true';

// Mock config at the top
jest.mock('../../config', () => ({
  getConfig: jest.fn(() => ({
    nodeEnv: 'development',
    port: 3002, // Use a different port to avoid conflicts
    apiBaseUrl: 'http://localhost:3002',
    sectorsAllowed: ['health-care', 'test'],
    dbProvider: 'mem',
    queueProvider: 'mem',
    kekSecret: 'test-kek-secret-dd-key-256-bits',
    host: {
      legalName: 'Gateway Test Host',
      jurisdiction: 'ES',
      idType: 'vat',
      idValue: 'B12345678',
      adminEmail: 'admin@host.com',
      adminUid: 'host-admin-uid',
    },
    mongo: { dbName: 'test-db' },
    firebase: {},
  })),
}));

import express from 'express';
import { Server } from 'http';
import request from 'supertest';
import { startServer } from '../../server';
import { QueueAdapter } from '../../adapters/queue';
import { IKmsService } from '../../crypto/interfaces/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { DecodedDidcommMessage, JobRequest } from '../../models/request';
import { testEncryptedJwe1 } from '../data/async-response.data';
import { testFabricEnrollmentJobInput, testTenantC_DidDocument } from '../data/fabric-enrollment.data';
import { testTenant1AddressCountry, testTenant1AlternateName, testTenant1ServiceProviderCategory } from '../data/organization.data';

describe('Fabric Enrollment API', () => {
  let app: express.Express;
  let server: Server;
  let queueAdapter: QueueAdapter;
  let kmsService: IKmsService;
  let tenantManager: TenantsCacheManager;
  let addJobSpy: jest.SpyInstance;

  beforeAll(async () => {
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
    kmsService = serverInstance.kmsService!;
    tenantManager = serverInstance.tenantManager;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll((done) => {
    if (addJobSpy) addJobSpy.mockRestore();
    server.close(done);
  });

  describe('POST /{tenantId}/cds-.../v1/fabric/org.schema/Action/_batch', () => {
    
    it('should authorize the controller, queue a job, and return 202 Accepted', async () => {
      // --- Arrange ---
      const tenantId = testTenant1AlternateName;
      const jurisdiction = testTenant1AddressCountry;
      const sector = testTenant1ServiceProviderCategory;
      const section = 'fabric';
      const format = 'org.schema';
      const resourceType = 'Action';
      const action = '_batch';

      const enrollmentUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      const expectedPollingUrl = `${enrollmentUrl.replace('/_batch', '/_batch-response')}?thid=${testFabricEnrollmentJobInput.thid}`;

      // CORRECTED: The KMS mock must resolve with a complete JobRequest object,
      // as the router expects the 'input' property to already exist.
      const mockJobRequest: JobRequest = {
        tenantId: '', // This is overwritten by the router
        resourceType: 'Action',
        action: '_batch',
        input: testFabricEnrollmentJobInput,
        meta: {},
      };
      const decodeJobRequestSpy = jest.spyOn(kmsService, 'decodeJobRequest').mockResolvedValue(mockJobRequest);

      const getDidDocumentSpy = jest.spyOn(tenantManager, 'getDidDocument').mockReturnValue(testTenantC_DidDocument);

      // --- Act ---
      const response = await request(app)
        .post(enrollmentUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(response.status).toBe(202);
      expect(response.headers.location).toBe(expectedPollingUrl);
      
      expect(decodeJobRequestSpy).toHaveBeenCalled();
      expect(getDidDocumentSpy).toHaveBeenCalledWith(expect.stringContaining(tenantId));
      expect(addJobSpy).toHaveBeenCalledTimes(1);
      
      const queuedJob = addJobSpy.mock.calls[0][1] as JobRequest;
      // The router should have overwritten the tenantId
      expect(queuedJob.tenantId).toBe(tenantId);
      // The input should be the object originally resolved by the KMS
      expect(queuedJob.input).toEqual(testFabricEnrollmentJobInput);
    });

    it('should return 403 Forbidden if the issuer is not in the DID assertionMethod', async () => {
      // --- Arrange ---
      const tenantId = testTenant1AlternateName;
      const jurisdiction = testTenant1AddressCountry;
      const sector = testTenant1ServiceProviderCategory;
      const section = 'fabric';
      const format = 'org.schema';
      const resourceType = 'Action';
      const action = '_batch';

      const enrollmentUrl = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/${section}/${format}/${resourceType}/${action}`;
      
      // CORRECTED: The unauthorized controller is inside the 'input' of a JobRequest
      const jobFromUnauthorizedController: DecodedDidcommMessage = {
        ...testFabricEnrollmentJobInput,
        iss: 'did:web:unauthorized.controller.com',
      };
      const mockJobRequest: JobRequest = {
        tenantId: '',
        resourceType: 'Action',
        action: '_batch',
        input: jobFromUnauthorizedController,
        meta: {},
      };

      // Spy on real instances for this specific test
      const getDidServiceConfigSpy = jest.spyOn(tenantManager, 'getDidServiceConfig').mockReturnValue([
        { id: '1', type: 'FabricService', serviceEndpoint: 'Action', actions: ['_batch'] },
      ]);
      const decodeJobRequestSpy = jest.spyOn(kmsService, 'decodeJobRequest').mockResolvedValue(mockJobRequest);
      const getDidDocumentSpy = jest.spyOn(tenantManager, 'getDidDocument').mockReturnValue(testTenantC_DidDocument);
      
      // --- Act ---
      const response = await request(app)
        .post(enrollmentUrl)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`request=${testEncryptedJwe1}`);

      // --- Assert ---
      expect(response.status).toBe(403);
      expect(addJobSpy).not.toHaveBeenCalled();

      // Verify that the authorization logic was still called
      expect(decodeJobRequestSpy).toHaveBeenCalled();
      expect(getDidDocumentSpy).toHaveBeenCalledWith(expect.stringContaining(tenantId));
    });
  });
});