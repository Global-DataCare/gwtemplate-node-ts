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
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import type { EntityConfig } from '../../gdc-backend-utils-node/models/entity';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ManageAssetCryptographicKey } from '../../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../../blockchain/fabric/v3/manageAssetSubjectKeyBinding';

const TEST_API_BASE_URL = 'http://localhost:3001';

describe('DeviceRegistrationManager', () => {
  let manager: DeviceRegistrationManager;
  let vaultRepository: VaultMemRepository;
  const originalNetworkMode = process.env.NETWORK_MODE;
  const originalLedgerEnabled = process.env.LEDGER_ENABLED;
  const originalLedgerMspId = process.env.LEDGER_MSP_ID;
  
  beforeEach(() => {
    jest.clearAllMocks();
    vaultRepository = new VaultMemRepository();
    manager = new DeviceRegistrationManager(TEST_API_BASE_URL, vaultRepository, mockKmsService);
    delete process.env.NETWORK_MODE;
    delete process.env.LEDGER_ENABLED;
    delete process.env.LEDGER_MSP_ID;
  });

  afterAll(() => {
    process.env.NETWORK_MODE = originalNetworkMode;
    process.env.LEDGER_ENABLED = originalLedgerEnabled;
    process.env.LEDGER_MSP_ID = originalLedgerMspId;
  });
  
  it('should be defined', () => {
    expect(manager).toBeDefined();
  });

  describe('process', () => {
    it('should process a valid DCR job and return a success response with a client_id', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).application_type = 'native';
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

    it('should replace the previous device for the same employee license and sync employee identity', async () => {
      process.env.NETWORK_MODE = 'local-network';
      process.env.LEDGER_ENABLED = 'true';
      process.env.LEDGER_MSP_ID = 'Org1MSP';

      const registerKeySpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
      const keySubmitSpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'submit').mockResolvedValue({} as any);
      const bindingSpy = jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);

      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).application_type = 'native';
      (job.content?.body as any).jwks = {
        keys: [
          {
            kty: 'AKP',
            alg: 'ML-DSA-44',
            kid: 'sig-new',
            use: 'sig',
            pub: 'sig-new-pub',
          },
          {
            kty: 'OKP',
            crv: 'ML-KEM-768',
            kid: 'enc-new',
            use: 'enc',
            x: 'enc-new-x',
          },
        ],
      };

      const activationCode = (job.content?.body as any)?.code as string;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);

      const employeeId = 'employee-1';
      const employeeDid = 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211';
      const employeeConfig: EntityConfig = {
        id: employeeId,
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsPersonSchemaorg.email]: 'doctor1@acme.org',
          [ClaimsPersonSchemaorg.hasOccupation]: 'ISCO-08|2211',
        } as any,
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: employeeDid,
          verificationMethod: [
            {
              id: `${employeeDid}#sig-old`,
              type: 'JsonWebKey',
              controller: employeeDid,
              publicKeyJwk: {
                kty: 'AKP',
                alg: 'ML-DSA-44',
                kid: 'sig-old',
                use: 'sig',
                pub: 'sig-old-pub',
              } as any,
            },
            {
              id: `${employeeDid}#enc-old`,
              type: 'JsonWebKey',
              controller: employeeDid,
              publicKeyJwk: {
                kty: 'OKP',
                crv: 'ML-KEM-768',
                kid: 'enc-old',
                use: 'enc',
                x: 'enc-old-x',
              } as any,
            },
          ],
          authentication: [`${employeeDid}#sig-old`],
          keyAgreement: [`${employeeDid}#enc-old`],
          service: [],
        },
        didConfig: { service: [] },
        meta: { lastUpdated: '2026-06-01T00:00:00.000Z' },
      };
      const protectedEmployeeDoc = await mockKmsService.protectConfidentialData({
        id: employeeId,
        status: employeeConfig.status,
        sequence: 0,
        content: employeeConfig,
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedEmployeeDoc], getEnvSectionId('employees'));

      const previousDeviceId = 'old-device-001';
      const protectedPreviousProfile = await mockKmsService.protectConfidentialData({
        id: previousDeviceId,
        status: 'active',
        sequence: 0,
        content: {
          type: 'DeviceProfile',
          clientId: previousDeviceId,
          jwks: {
            keys: [
              { kty: 'AKP', alg: 'ML-DSA-44', kid: 'sig-old', use: 'sig', pub: 'sig-old-pub' },
              { kty: 'OKP', crv: 'ML-KEM-768', kid: 'enc-old', use: 'enc', x: 'enc-old-x' },
            ],
          },
          verificationMethodIds: [`${employeeDid}#sig-old`, `${employeeDid}#enc-old`],
        },
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedPreviousProfile], getEnvSectionId('device-profiles'));

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
        subjectId: employeeId,
        deviceId: previousDeviceId,
      } as any;
      const licenseDoc: ConfidentialStorageDoc = {
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      };
      await vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);
      const responseEntry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      const newClientId = String((responseEntry.resource as any).client_id || '');

      expect(responseEntry.response.status).toBe('201');
      expect(newClientId).toBeTruthy();
      expect(newClientId).not.toBe(previousDeviceId);

      const revokedProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        previousDeviceId,
        getEnvSectionId('device-profiles'),
      );
      const revokedProfileContent = await mockKmsService.unprotectConfidentialData<any>(revokedProfileDoc!, vaultId);
      expect(revokedProfileDoc?.status).toBe('revoked');
      expect(revokedProfileContent.replacedByClientId).toBe(newClientId);

      const updatedEmployeeDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        employeeId,
        getEnvSectionId('employees'),
      );
      const updatedEmployee = await mockKmsService.unprotectConfidentialData<EntityConfig>(updatedEmployeeDoc!, vaultId);
      expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
        expect.arrayContaining([`${employeeDid}#sig-new`, `${employeeDid}#enc-new`]),
      );
      expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).not.toEqual(
        expect.arrayContaining([`${employeeDid}#sig-old`, `${employeeDid}#enc-old`]),
      );

      expect(registerKeySpy).toHaveBeenCalledTimes(2);
      expect(keySubmitSpy).toHaveBeenCalledWith('Org1MSP', 'UpdateKeyStatus', expect.any(String), 'revoked', expect.any(String));
      expect(bindingSpy).toHaveBeenCalled();
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
