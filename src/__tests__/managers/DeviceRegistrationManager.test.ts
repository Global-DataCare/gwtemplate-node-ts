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
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import { DeviceBindingStatuses } from 'gdc-common-utils-ts/constants/device';
import { IdentityAuthActions, IdentityAuthRequestFields } from 'gdc-common-utils-ts/constants/identity-auth';
import {
  EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY,
  EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_TERTIARY,
  ExampleHttpStatusText,
} from 'gdc-common-utils-ts/examples/shared';
import {
  EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
  EXAMPLE_LICENSE_ACTIVE_RECORD,
} from 'gdc-common-utils-ts/examples/license';

const TEST_API_BASE_URL = 'http://localhost:3001';
const FABRIC_LEDGER_TEST_ENV = {
  NETWORK_MODE: 'local-network',
  LEDGER_ENABLED: 'true',
  LEDGER_PROVIDER_DEFAULT: 'mem',
  LEDGER_PROVIDER_MAP: 'local-network=fabric',
  LEDGER_MSP_ID: 'Org1MSP',
} as const;

describe('DeviceRegistrationManager', () => {
  let manager: DeviceRegistrationManager;
  let vaultRepository: VaultMemRepository;
  const originalNetworkMode = process.env.NETWORK_MODE;
  const originalLedgerEnabled = process.env.LEDGER_ENABLED;
  const originalLedgerProviderDefault = process.env.LEDGER_PROVIDER_DEFAULT;
  const originalLedgerProviderMap = process.env.LEDGER_PROVIDER_MAP;
  const originalLedgerMspId = process.env.LEDGER_MSP_ID;
  
  beforeEach(() => {
    jest.clearAllMocks();
    vaultRepository = new VaultMemRepository();
    manager = new DeviceRegistrationManager(TEST_API_BASE_URL, vaultRepository, mockKmsService);
    delete process.env.NETWORK_MODE;
    delete process.env.LEDGER_ENABLED;
    delete process.env.LEDGER_PROVIDER_DEFAULT;
    delete process.env.LEDGER_PROVIDER_MAP;
    delete process.env.LEDGER_MSP_ID;
  });

  afterAll(() => {
    process.env.NETWORK_MODE = originalNetworkMode;
    process.env.LEDGER_ENABLED = originalLedgerEnabled;
    process.env.LEDGER_PROVIDER_DEFAULT = originalLedgerProviderDefault;
    process.env.LEDGER_PROVIDER_MAP = originalLedgerProviderMap;
    process.env.LEDGER_MSP_ID = originalLedgerMspId;
  });
  
  it('should be defined', () => {
    expect(manager).toBeDefined();
  });

  describe('process', () => {
    it('should process a valid web DCR job and return a success response with a client_id', async () => {
      // Arrange
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).application_type = 'web';
      (job.content?.body as any).software_id = 'com.example.professional';
      (job.content?.body as any).software_version = '2.4.0';
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
      const deviceProfile = await mockKmsService.unprotectConfidentialData<any>(deviceProfileDoc!, vaultId);
      expect(deviceProfile.software_id).toBe('com.example.professional');
      expect(deviceProfile.software_version).toBe('2.4.0');
      expect(deviceProfile.application_type).toBe('web');

      const updatedLicense = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        license.id,
        getEnvSectionId('device-licenses')
      );
      const updatedContent = (updatedLicense?.content || {}) as DeviceLicense;
      expect(updatedContent.deviceId).toBe(resource.client_id);
      expect((updatedContent as any).maxDevices).toBe(2);
      expect((updatedContent as any).deviceBindings).toHaveLength(1);
      expect(updatedContent.status).toBe('active');
    });

    it('should keep two devices and both key sets active for the same employee seat', async () => {
      Object.assign(process.env, FABRIC_LEDGER_TEST_ENV);

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
        activatedBy: normalizeSameAsHash('employee@example.org'),
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

      const previousProfileDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        previousDeviceId,
        getEnvSectionId('device-profiles'),
      );
      expect(previousProfileDoc?.status).toBe('active');

      const updatedEmployeeDoc = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        employeeId,
        getEnvSectionId('employees'),
      );
      const updatedEmployee = await mockKmsService.unprotectConfidentialData<EntityConfig>(updatedEmployeeDoc!, vaultId);
      expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
        expect.arrayContaining([`${employeeDid}#sig-new`, `${employeeDid}#enc-new`]),
      );
      expect(updatedEmployee.didDocument?.verificationMethod?.map((method) => method.id)).toEqual(
        expect.arrayContaining([`${employeeDid}#sig-old`, `${employeeDid}#enc-old`]),
      );

      const updatedLicense = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, license.id, getEnvSectionId('device-licenses'),
      );
      expect((updatedLicense?.content as any).deviceId).toBe(previousDeviceId);
      expect((updatedLicense?.content as any).deviceBindings.filter((binding: any) => binding.status === 'active')).toHaveLength(2);

      expect(registerKeySpy).toHaveBeenCalledTimes(2);
      expect(keySubmitSpy).not.toHaveBeenCalled();
      expect(bindingSpy).toHaveBeenCalled();
      expect(bindingSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('urn:multibase:'),
        expect.objectContaining({
          subjectId: license.activatedBy,
          meta: expect.objectContaining({
            attributes: expect.objectContaining({ did: employeeDid }),
          }),
        }),
      );
    });

    it('should reject a third installation when the seat allowance is two', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).ext_device_info.device_id = EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_TERTIARY;
      const activationCode = (job.content?.body as any).code;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      await vaultRepository.put(vaultId, [{
        id: 'license-full', status: 'active', sequence: 0, content: {
          id: 'license-full', tenantId: job.tenantId, orderId: 'order', activationCode,
          userClass: 'employee', type: 'web', status: 'active', plan: 'default',
          renewalCycle: '12m', reactivationEnabled: false, exp: Math.floor(Date.now() / 1000) + 3600,
          maxDevices: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS.length,
          deviceBindings: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
        },
      } as any], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);
      expect(((result.body as BundleJsonApi).data[0] as ErrorEntry).response.status).toBe(ExampleHttpStatusText.Conflict);
    });

    it('revokes one selected installation and keeps the other device active on the same seat', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      job.action = IdentityAuthActions.Revoke;
      job.content!.body = {
        [IdentityAuthRequestFields.LicenseId]: EXAMPLE_LICENSE_ACTIVE_RECORD.id,
        [IdentityAuthRequestFields.ClientId]: EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY,
      } as any;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      await vaultRepository.put(vaultId, [{
        id: EXAMPLE_LICENSE_ACTIVE_RECORD.id, status: EXAMPLE_LICENSE_ACTIVE_RECORD.status, sequence: 0, content: {
          id: EXAMPLE_LICENSE_ACTIVE_RECORD.id, tenantId: job.tenantId, orderId: 'order', userClass: 'employee',
          type: 'web', status: 'active', plan: 'default', renewalCycle: '12m',
          reactivationEnabled: false, exp: Math.floor(Date.now() / 1000) + 3600, maxDevices: 2,
          deviceBindings: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
        },
      } as any], getEnvSectionId('device-licenses'));
      const profile = await mockKmsService.protectConfidentialData({
        id: EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY, status: DeviceBindingStatuses.Active, sequence: 0,
        content: { clientId: EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY, verificationMethodIds: [] },
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [profile], getEnvSectionId('device-profiles'));

      const result = await manager.process(job);
      expect(((result.body as BundleJsonApi).data[0] as BundleEntryResponse).response.status).toBe(ExampleHttpStatusText.Ok);
      const updated = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, EXAMPLE_LICENSE_ACTIVE_RECORD.id, getEnvSectionId('device-licenses'),
      );
      expect((updated?.content as any).deviceBindings.filter((binding: any) => binding.status === DeviceBindingStatuses.Active))
        .toHaveLength(1);
      expect((updated?.content as any).deviceBindings.find((binding: any) => binding.clientId === EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY).status)
        .toBe(DeviceBindingStatuses.Revoked);
      const revokedProfile = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId, EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY, getEnvSectionId('device-profiles'),
      );
      expect(revokedProfile?.status).toBe(DeviceBindingStatuses.Revoked);
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
