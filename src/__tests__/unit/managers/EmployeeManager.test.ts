// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/EmployeeManager.test.ts

import { jest } from '@jest/globals';
import { mock, MockProxy } from 'jest-mock-extended';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ClaimsOfferSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { RecordBase, ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { JwkSet } from '../../../gdc-backend-utils-node/models/jwk';
import { testBaseJobForEmployeeClaims as testBaseJobForEmployeeClaims, testClaimsTenant1Receptionist1 } from '../../data/employee.data';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import { normalizeCodeSystemAndValue } from '../../../utils/normalize-codeAndSystem';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { getEnvSectionId } from '../../../utils/section-env';
import { EntityLifecycleStatus, EntityType } from '../../../gdc-backend-utils-node/models/enums';

const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { v4: uuidv4 } = await import('uuid');
const { EmployeeManager } = await import('../../../managers/EmployeeManager');

describe('EmployeeManager', () => {
  let employeeManager: InstanceType<typeof EmployeeManager>;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockKmsService: MockProxy<IKmsService>;
  let mockTenantsCacheManager: MockProxy<TenantsCacheManager>;

  const mockJwkSet: JwkSet = { keys: [] };
  const MOCKED_OCCUPATION_UUID = 'mocked-occupation-uuid';
  const TENANT_ALTERNATE_NAME = 'tenant-1';
  const TENANT_SECTOR = 'health-care';
  const TENANT_VAULT_ID = `${TENANT_SECTOR}_${TENANT_ALTERNATE_NAME}`;
  const TENANT_URN = `urn:antifraud:soschain-test:us:v1:${TENANT_SECTOR}:entity:tax:123456789`;

  beforeEach(() => {
    mockVaultRepository = mock<IVaultRepository>();
    mockKmsService = mock<IKmsService>();
    mockTenantsCacheManager = mock<TenantsCacheManager>();
    employeeManager = new EmployeeManager(mockVaultRepository, mockKmsService, mockTenantsCacheManager);
    (uuidv4 as jest.Mock).mockReturnValue(MOCKED_OCCUPATION_UUID);
    jest.clearAllMocks();

    mockKmsService.protectConfidentialData.mockImplementation(
      async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
        const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' } };
        delete secureDoc.content;
        return secureDoc;
      },
    );
    mockKmsService.unprotectConfidentialData.mockImplementation(
      async <T>(doc: ConfidentialStorageDoc): Promise<T> => {
        if ((doc as any).content !== undefined) {
          return (doc as any).content as T;
        }
        return doc as unknown as T;
      },
    );
    
    // Mock for the new secure indexing flow
    mockKmsService.protectAttributesNameAndValue.mockImplementation(async (attributes) => {
      return attributes.map(attr => ({
        name: `hmac(${attr.name})`,
        value: `hmac(${attr.value})`,
        unique: attr.unique,
      }));
    });
  });

  describe('Employee Creation (POST)', () => {
    it('should create employee, index kids securely, and save protected documents', async () => {
      // ARRANGE
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});

      // ACT
      const response = await employeeManager.process(job);

      // ASSERT
      expect(mockTenantsCacheManager.getTenantIdentifierUrn).toHaveBeenCalledWith(TENANT_VAULT_ID);

      // Verify that all expected attributes were sent to be protected for indexing
      const signerKid = job.content?.meta?.jws?.protected?.jwk?.kid;
      const encrypterKid = job.content?.meta?.jwe?.header?.jwk?.kid;
      const email = testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email];
      const roleCode = testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.hasOccupation];

      expect(mockKmsService.protectAttributesNameAndValue).toHaveBeenNthCalledWith(
        2,
        [
          { name: 'email', value: email, unique: true, type: 'string'},
          { name: 'role', value: normalizeCodeSystemAndValue(roleCode as string), unique: false, type: 'token'},
          { name: 'kid', value: signerKid, unique: false, type: 'string'},
          { name: 'kid', value: encrypterKid, unique: false, type: 'string'},
        ],
        TENANT_VAULT_ID
      );
      
      const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const employeeConfig = docToProtect.content as EntityConfig;

      expect(employeeConfig.didDocument!.id).toMatch(
        new RegExp(`^${TENANT_URN}:employee:z[1-9A-HJ-NP-Za-km-z]+:role:isco-08\\|4226$`)
      );

      // Verify that the protected indexes from the mock were added to the document
      expect(docToProtect.indexed?.attributes).toHaveLength(4);
      expect(docToProtect.indexed?.attributes[0].name).toBe('hmac(email)');
      
      const savedDocs = mockVaultRepository.put.mock.calls[0][1] as (RecordBase | ConfidentialStorageDoc)[];
      expect(savedDocs).toHaveLength(2);
      const secureEmployeeDoc = savedDocs.find(
        doc => (doc as ConfidentialStorageDoc).jwe,
      ) as ConfidentialStorageDoc | undefined;
      expect(secureEmployeeDoc).toBeDefined();
      expect(secureEmployeeDoc!.content).toBeUndefined();

      expect(response.body.data[0].response.status).toBe('201');
      expect(response.iss).toBe(TENANT_URN);
    });

    it('should return an Offer when employee licenses exist but none are available', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getTenantDid.mockResolvedValue('did:web:host.example.com');

      const issuedLicense: DeviceLicense = {
        id: 'lic-1',
        tenantId: TENANT_ALTERNATE_NAME,
        orderId: 'order-1',
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'issued',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      mockVaultRepository.getContainersInSection.mockResolvedValueOnce([
        { id: issuedLicense.id, sequence: 0, content: issuedLicense } as unknown as ConfidentialStorageDoc,
      ]);

      const response = await employeeManager.process(job);

      const entry = response.body.data[0] as any;
      expect(entry.type).toBe('Employee-license-offer-v1.0');
      expect(entry.meta?.claims?.[ClaimsOfferSchemaorg.identifier]).toBeDefined();
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('should consume an available employee license before creating the employee', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);
      mockTenantsCacheManager.getEntityClaims.mockResolvedValue({});

      const availableLicense: DeviceLicense = {
        id: 'lic-available',
        tenantId: TENANT_ALTERNATE_NAME,
        orderId: 'order-1',
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'available',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      mockVaultRepository.getContainersInSection.mockResolvedValueOnce([
        { id: availableLicense.id, sequence: 0, content: availableLicense } as unknown as ConfidentialStorageDoc,
      ]);

      const response = await employeeManager.process(job);

      // First `put` consumes the license; second `put` persists the employee.
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
      const consumeCall = mockVaultRepository.put.mock.calls[0];
      expect(consumeCall[0]).toBe(TENANT_VAULT_ID);
      expect(consumeCall[2]).toBe(getEnvSectionId('device-licenses'));

      expect(response.body.data[0].response.status).toBe('201');
    });

    it('should return the existing active employee for the same email and role without consuming another license', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'existing-employee-id',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 2,
        content: existingEmployee,
      };
      mockVaultRepository.query.mockResolvedValue([existingSecureDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.query).toHaveBeenCalledTimes(1);
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
      expect(response.body.data[0].response.status).toBe('200');
      expect((response.body.data[0] as any).resource.id).toBe(existingEmployee.id);
    });

    it('should reactivate an existing inactive employee for the same email and role without consuming another license', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'inactive-employee-id',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Inactive,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-24T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 3,
        content: existingEmployee,
      };
      mockVaultRepository.query.mockResolvedValue([existingSecureDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const updatedDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedDocs[0].sequence).toBe(4);
      expect(updatedDocs[0].status).toBe(EntityLifecycleStatus.Active);
      expect(response.body.data[0].response.status).toBe('200');
      expect((response.body.data[0] as any).resource.id).toBe(existingEmployee.id);
    });
  });

  describe('Employee Deactivation (DELETE)', () => {
    it('should suspend the employee without releasing or mutating device licenses', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.content!.body!.data[0].request.method = 'DELETE';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-disable',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.get).toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        MOCKED_OCCUPATION_UUID,
        getEnvSectionId('employees'),
      );
      expect(mockVaultRepository.getContainersInSection).not.toHaveBeenCalledWith(
        TENANT_VAULT_ID,
        getEnvSectionId('device-licenses'),
      );
      const updatedDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
      expect(response.body.data[0].response.status).toBe('200');
    });
  });

  describe('Employee Purge', () => {
    it('should reject purge unless the employee is already inactive', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_purge';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-purge',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Active,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);

      const response = await employeeManager.process(job);
      const entry = response.body.data[0] as any;
      expect(entry.response.status).toBe('409');
      expect(entry.response.outcome.issue[0].diagnostics).toContain('disabled before purge');
    });

    it('should keep the employee record and release associated licenses on purge', async () => {
      const job = testBaseJobForEmployeeClaims(testClaimsTenant1Receptionist1, TENANT_ALTERNATE_NAME, TENANT_SECTOR);
      job.action = '_purge';
      mockTenantsCacheManager.getTenantIdentifierUrn.mockResolvedValue(TENANT_URN);

      const existingEmployee: EntityConfig = {
        id: 'employee-to-purge',
        type: EntityType.Person,
        status: EntityLifecycleStatus.Inactive,
        claims: testClaimsTenant1Receptionist1,
        meta: { lastUpdated: '2026-05-25T00:00:00.000Z' },
      };
      const existingSecureDoc: ConfidentialStorageDoc = {
        id: existingEmployee.id,
        status: existingEmployee.status,
        sequence: 1,
        content: existingEmployee,
      };
      const activeLicense: DeviceLicense = {
        id: 'license-1',
        tenantId: TENANT_ALTERNATE_NAME,
        orderId: 'order-1',
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'active',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 3600,
        subjectId: 'employee-to-purge',
        activationCode: 'lic-123',
        issuedToEmail: String(testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email]),
        issuedToRole: 'ISCO-08|4226',
      } as any;
      const licenseDoc: ConfidentialStorageDoc = {
        id: activeLicense.id,
        status: activeLicense.status,
        sequence: 2,
        content: activeLicense,
      };

      mockVaultRepository.get.mockResolvedValue(existingSecureDoc);
      mockVaultRepository.getContainersInSection.mockResolvedValue([licenseDoc]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await employeeManager.process(job);

      expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);
      const updatedLicenseDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedLicenseDocs[0].status).toBe('available');
      expect((updatedLicenseDocs[0].content as any).activationCode).toBeUndefined();
      expect((updatedLicenseDocs[0].content as any).subjectId).toBeUndefined();

      const protectedEmployeeDocInput = mockKmsService.protectConfidentialData.mock.calls.at(-1)?.[0] as ConfidentialStorageDoc;
      expect((protectedEmployeeDocInput.content as any).meta.licensingPurgedAt).toBeDefined();
      const updatedEmployeeDocs = mockVaultRepository.put.mock.calls[1][1] as ConfidentialStorageDoc[];
      expect(updatedEmployeeDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
      expect(response.body.data[0].response.status).toBe('200');
    });
  });
});
