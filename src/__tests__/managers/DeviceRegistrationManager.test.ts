// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
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
import {
  IdentityAuthActions,
  IdentityAuthRequestFields,
  IdentityDcrMetadataFields,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_EMAIL_PROFESSIONAL,
  EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY,
  EXAMPLE_EMPLOYEE_DEVICE_INSTANCE_ID_TERTIARY,
  EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_TENANT_ROUTE_CONTEXT,
  ExampleHttpStatusText,
} from 'gdc-common-utils-ts/examples/shared';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import {
  EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
  EXAMPLE_LICENSE_ACTIVE_RECORD,
} from 'gdc-common-utils-ts/examples/license';
import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare';
import { createEmployeeUrn } from '../../utils/urn';
import { URN_NAMESPACE, URN_NETWORK, URN_ORGANIZATION_ID_TYPE, URN_VERSION } from '../data/urn.data';
import { testIndividualControllerDcrIdentity } from '../data/identity.data';
import { DeviceAppTypes, DeviceUserClasses } from 'gdc-common-utils-ts/constants/device';
import { LicenseStatuses } from 'gdc-common-utils-ts/utils/license';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { FhirIpsCreatorKinds } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { buildOrganizationRoleLicenseId } from 'gdc-common-utils-ts/utils/organization-role-license';
import { getClinicalCreatorBindingsSectionId } from '../../utils/clinical-creator-binding';

const TEST_API_BASE_URL = 'http://localhost:3001';
const FABRIC_LEDGER_TEST_ENV = {
  NETWORK_MODE: 'local-network',
  LEDGER_ENABLED: 'true',
  LEDGER_PROVIDER_DEFAULT: 'mem',
  LEDGER_PROVIDER_MAP: 'local-network=fabric',
  LEDGER_MSP_ID: 'Host1MSP',
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
      expect((responseEntry as any).meta?.claims).toBeUndefined();
      
      const resource = responseEntry.resource as any;
      expect(resource.resourceType).toEqual('Device');
      expect(resource.meta?.claims).toBeDefined();
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
      expect((updatedContent as any).maxDevices).toBe(5);
      expect((updatedContent as any).deviceBindings).toHaveLength(1);
      expect(updatedContent.status).toBe('active');
      expect(updatedLicense?.status).toBe('active');
    });

    it('links DCR client and key aliases only to an existing stable clinical creator assignment', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const body = job.content?.body as any;
      const activationCode = String(body?.code);
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const actorDid = 'did:web:clinic.example:employees:stable-practitioner';
      const binding = {
        id: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        kind: FhirIpsCreatorKinds.Professional,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`,
        ownerIdentifier: 'did:web:clinic.example',
        role: HealthcareActorRoles.Veterinarian,
      };
      Object.assign(body, {
        [IdentityDcrMetadataFields.ActorDid]: actorDid,
        [IdentityDcrMetadataFields.ProfileDid]: actorDid,
        [IdentityDcrMetadataFields.ClinicalCreatorBinding]: {
          kind: binding.kind,
          actorIdentifier: binding.actorIdentifier,
          authorIdentifier: binding.authorIdentifier,
          ownerIdentifier: binding.ownerIdentifier,
          role: binding.role,
        },
      });
      await vaultRepository.put(vaultId, [{
        id: 'license-clinical-creator',
        status: 'issued',
        sequence: 0,
        content: {
          id: 'license-clinical-creator',
          tenantId: job.tenantId,
          orderId: 'order-clinical-creator',
          activationCode,
          userClass: 'employee',
          type: 'web',
          status: 'issued',
          plan: 'default',
          renewalCycle: '12m',
          reactivationEnabled: false,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      }], getEnvSectionId('device-licenses'));

      const rejected = await manager.process(job);
      expect(((rejected.body as BundleJsonApi).data[0] as ErrorEntry).response.status)
        .toBe(String(HttpStatusCodes.Forbidden));

      await vaultRepository.put(vaultId, [binding], getClinicalCreatorBindingsSectionId());
      const result = await manager.process(job);

      const entry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      expect(entry.response.status).toBe(String(HttpStatusCodes.Created));
      const clientId = String((entry.resource as any).client_id);
      const stored = await vaultRepository.get<any>(
        vaultId,
        binding.authorIdentifier,
        getClinicalCreatorBindingsSectionId(),
      );
      expect(stored).toEqual(expect.objectContaining({
        ...binding,
        actorDids: [actorDid],
        dcrClientIds: expect.arrayContaining([clientId, body.ext_device_info.device_id]),
        keyIds: expect.arrayContaining(body.jwks.keys.map((key: any) => key.kid)),
      }));
    });

    it('binds an individual-controller DCR to the verified account and licensed subject', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      const activationCode = String((job.content?.body as any)?.[IdentityAuthRequestFields.Code]);
      Object.assign(job.content!.body as any, {
        [IdentityDcrMetadataFields.ActorDid]: testIndividualControllerDcrIdentity.actorDid,
        [IdentityDcrMetadataFields.ProfileDid]: testIndividualControllerDcrIdentity.actorDid,
      });
      job.content!.meta = {
        bearer: { jwt: { payload: {
          sub: testIndividualControllerDcrIdentity.authenticatedSubject,
          act_code: activationCode,
          scope: testIndividualControllerDcrIdentity.scope,
        } } },
      } as any;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const license = {
        ...EXAMPLE_LICENSE_ACTIVE_RECORD,
        tenantId: job.tenantId,
        orderId: EXAMPLE_LICENSE_ACTIVE_RECORD.id,
        activationCode,
        userClass: DeviceUserClasses.Individual,
        type: DeviceAppTypes.Mobile,
        status: LicenseStatuses.Active,
        issuedToRole: testIndividualControllerDcrIdentity.role,
        authorizedSubjectDid: testIndividualControllerDcrIdentity.subjectDid,
      } as DeviceLicense & Record<string, any>;
      await vaultRepository.put(vaultId, [{
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      }], getEnvSectionId('device-licenses'));

      const result = await manager.process(job);

      const entry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      expect(entry.response.status).toBe(String(HttpStatusCodes.Created));
      const clientId = String((entry.resource as any).client_id);
      const stored = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        clientId,
        getEnvSectionId('device-profiles'),
      );
      const profile = await mockKmsService.unprotectConfidentialData<any>(stored!, vaultId);
      expect(profile).toEqual(expect.objectContaining({
        actorDid: testIndividualControllerDcrIdentity.actorDid,
        profileDid: testIndividualControllerDcrIdentity.actorDid,
        authorizedSubjectDid: testIndividualControllerDcrIdentity.subjectDid,
        authenticatedSubject: testIndividualControllerDcrIdentity.authenticatedSubject,
        licenseId: license.id,
      }));
    });

    it('decrypts and updates the protected seat selected by its activation-code index', async () => {
      const job = cloneDeep(DCR_REGISTRATION_JOB);
      (job.content?.body as any).application_type = 'web';
      const activationCode = (job.content?.body as any).code as string;
      const clientInstanceId = (job.content?.body as any).ext_device_info.device_id as string;
      const vaultId = getTenantVaultId(job.sector as any, job.tenantId as string);
      const license = {
        id: 'protected-license',
        tenantId: job.tenantId as string,
        orderId: 'protected-order',
        activationCode,
        userClass: 'employee',
        type: 'web',
        status: 'active',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        activatedBy: normalizeSameAsHash('employee@example.org'),
        maxDevices: 5,
      } as DeviceLicense & Record<string, any>;
      const protectedLicense = await mockKmsService.protectConfidentialData({
        id: license.id,
        status: license.status,
        sequence: 3,
        indexed: { attributes: [{ name: 'protected-name', value: 'protected-value' }] },
        content: license,
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedLicense], getEnvSectionId('device-licenses'));
      mockKmsService.getHmacBase64Url
        .mockResolvedValueOnce('protected-name')
        .mockResolvedValueOnce('protected-value');

      const result = await manager.process(job);

      const responseEntry = (result.body as BundleJsonApi).data[0] as BundleEntryResponse;
      expect(responseEntry.response.status).toBe('201');
      const updatedDocument = await vaultRepository.get<ConfidentialStorageDoc>(
        vaultId,
        license.id,
        getEnvSectionId('device-licenses'),
      );
      expect(updatedDocument?.content).toBeUndefined();
      expect(updatedDocument?.jwe).toBeDefined();
      const updatedLicense = await mockKmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
        updatedDocument!,
        vaultId,
      );
      expect(updatedLicense.deviceBindings).toEqual(expect.arrayContaining([
        expect.objectContaining({ clientInstanceId, status: DeviceBindingStatuses.Active }),
      ]));
    });

    it('should normalize the canonical organization owner when binding two devices to one employee seat', async () => {
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
      const employeeDid = EXAMPLE_CONTROLLER_DID;
      const employeeUrn = createEmployeeUrn({
        namespace: URN_NAMESPACE,
        network: URN_NETWORK,
        jurisdiction: EXAMPLE_TENANT_ROUTE_CONTEXT.jurisdiction,
        version: URN_VERSION,
        sector: EXAMPLE_TENANT_ROUTE_CONTEXT.sector,
        idType: URN_ORGANIZATION_ID_TYPE,
        idValue: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        email: EXAMPLE_EMAIL_PROFESSIONAL,
        role: HealthcareActorRoles.GeneralistMedicalPractitioner,
      });
      const employeeConfig: EntityConfig = {
        id: employeeId,
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsPersonSchemaorg.email]: EXAMPLE_EMAIL_PROFESSIONAL,
          [ClaimsPersonSchemaorg.hasOccupation]: HealthcareActorRoles.GeneralistMedicalPractitioner,
        } as any,
        didDocument: {
          '@context': 'https://www.w3.org/ns/did/v1',
          id: employeeDid,
          alsoKnownAs: [employeeUrn],
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
        indexed: { attributes: [{ name: 'protected-kid', value: 'protected-old-kid' }] },
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
        activatedBy: normalizeSameAsHash(EXAMPLE_EMAIL_PROFESSIONAL),
        ownerOrganizationId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PROVIDER_ORGANIZATION_URN,
        issuedToRole: HealthcareActorRoles.GeneralistMedicalPractitioner,
        deviceId: previousDeviceId,
      } as any;
      const licenseDoc: ConfidentialStorageDoc = {
        id: license.id,
        status: license.status,
        sequence: 0,
        content: license,
      };
      await vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));
      mockKmsService.protectAttributesNameAndValue.mockImplementation(async (attributes) => (
        attributes.map((attribute) => ({ ...attribute, name: 'protected-kid', value: `protected-${attribute.value}` }))
      ));

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
      expect(updatedEmployeeDoc?.indexed?.attributes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'protected-kid', value: 'protected-sig-old' }),
        expect.objectContaining({ name: 'protected-kid', value: 'protected-enc-old' }),
        expect.objectContaining({ name: 'protected-kid', value: 'protected-sig-new' }),
        expect.objectContaining({ name: 'protected-kid', value: 'protected-enc-new' }),
      ]));
      expect(updatedEmployeeDoc?.indexed?.attributes).not.toContainEqual(
        expect.objectContaining({ value: 'protected-old-kid' }),
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
        expect.stringContaining(employeeUrn),
        expect.objectContaining({
          subjectId: employeeUrn,
          licensedRole: HealthcareActorRoles.GeneralistMedicalPractitioner,
          roleLicenseId: buildOrganizationRoleLicenseId({
            organizationOfficialId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
            jurisdiction: EXAMPLE_TENANT_ROUTE_CONTEXT.jurisdiction.toLowerCase(),
            stableContactIdentifier: normalizeSameAsHash(EXAMPLE_EMAIL_PROFESSIONAL),
            licensedRole: HealthcareActorRoles.GeneralistMedicalPractitioner,
          }),
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
      const protectedLicense = await mockKmsService.protectConfidentialData({
        id: EXAMPLE_LICENSE_ACTIVE_RECORD.id, status: EXAMPLE_LICENSE_ACTIVE_RECORD.status, sequence: 0, content: {
          id: EXAMPLE_LICENSE_ACTIVE_RECORD.id, tenantId: job.tenantId, orderId: 'order', userClass: 'employee',
          type: 'web', status: 'active', plan: 'default', renewalCycle: '12m',
          reactivationEnabled: false, exp: Math.floor(Date.now() / 1000) + 3600, maxDevices: 2,
          deviceBindings: EXAMPLE_EMPLOYEE_ACTIVE_DEVICE_BINDINGS,
        },
      } as ConfidentialStorageDoc, vaultId);
      await vaultRepository.put(vaultId, [protectedLicense], getEnvSectionId('device-licenses'));
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
      const updatedContent = await mockKmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
        updated!, vaultId,
      );
      const updatedBindings = updatedContent.deviceBindings || [];
      expect(updatedBindings.filter((binding: any) => binding.status === DeviceBindingStatuses.Active))
        .toHaveLength(1);
      expect(updatedBindings.find((binding: any) => binding.clientId === EXAMPLE_EMPLOYEE_DEVICE_CLIENT_ID_PRIMARY)?.status)
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
