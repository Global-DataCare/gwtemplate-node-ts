// src/__tests__/managers/DeviceRegistrationManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import cloneDeep from 'lodash.clonedeep';
import { validate as uuidValidate } from 'uuid';
import { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { DeviceRegistrationManager } from '../../managers/DeviceRegistrationManager';
import { DCR_REGISTRATION_JOB } from '../data/example-jobs';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { mockKmsService } from '../mocks/kms.mock';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';

const TEST_API_BASE_URL = 'http://localhost:3001';

describe('DeviceRegistrationManager', () => {
  let manager: DeviceRegistrationManager;
  let vaultRepository: VaultMemRepository;
  
  beforeEach(() => {
    vaultRepository = new VaultMemRepository();
    manager = new DeviceRegistrationManager(TEST_API_BASE_URL, vaultRepository, mockKmsService);
  });
  
  it('should be defined', () => {
    expect(manager).toBeDefined();
  });

  describe('process', () => {
    it('should process a valid DCR job and return a success response with a client_id', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const activationCode = (job.content?.body as any)?.code as string;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const license: DeviceLicense = {
        id: 'license-1',
        tenantId: job.tenantId as string,
        orderId: 'order-1',
        activationCode,
        userClass: 'employee',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const licenseDoc: ConfidentialStorageDoc = {
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      };
      await vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));

      // Act
      const result = await manager.process(job);

      // Assert
      const responseBody = result.body as BundleJsonApi;
      const responseEntry = responseBody.data[0] as BundleEntryResponse;
      expect(responseEntry.response.status).toEqual('201');
      
      const resource = responseEntry.resource as any;
      expect(resource.resourceType).toEqual('Device');
      expect(uuidValidate(resource.client_id)).toBe(true);
      expect(resource.client_id_issued_at).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
      expect(resource.registration_client_uri).toBe(`${TEST_API_BASE_URL}/clients/${resource.client_id}`);

      const deviceProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        resource.client_id,
        getEnvSectionId('device-profiles')
      );
      expect(deviceProfileDoc).toBeDefined();
      expect(deviceProfileDoc?.jwe).toBeDefined();

      const updatedLicense = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        license.id,
        getEnvSectionId('device-licenses')
      );
      const updatedContent = (updatedLicense?.content || {}) as DeviceLicense;
      expect(updatedContent.deviceId).toBe(resource.client_id);
      expect(updatedContent.status).toBe('active');
    });

    it('should return a 400 error if redirect_uris are missing', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      delete (job.content?.body as any).redirect_uris;

      // Act
      const result = await manager.process(job);

      // Assert
      const errorEntry = (result.body as BundleJsonApi).data[0] as ErrorEntry;
      expect(errorEntry.response.status).toEqual('400');
      expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
        '`redirect_uris` is a required field and must be a non-empty array.'
      );
    });

    it('should return a 400 error if jwks is missing', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).jwks = { keys: [] }; // Empty keys

      // Act
      const result = await manager.process(job);

      // Assert
      const errorEntry = (result.body as BundleJsonApi).data[0] as ErrorEntry;
      expect(errorEntry.response.status).toEqual('400');
      expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
        'Either `jwks` or `jwks_uri` is a required field.'
      );
    });
  });
});
