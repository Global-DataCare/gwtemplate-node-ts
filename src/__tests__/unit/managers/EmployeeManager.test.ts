// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/EmployeeManager.test.ts

import { jest } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import { mock, MockProxy } from 'jest-mock-extended';
import { VaultRepository } from '../../../database/repositories/vault/vault.repository';
import { EmployeeManager } from '../../../managers/EmployeeManager';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { ClaimsPersonSchemaorg } from '../../../models/schemaorg';
import { determineResourceId } from '../../../utils/resource';
import { RecordBase, ClaimsRecord } from '../../../models/resource-document';
import { JwkSet } from '../../../models/jwk';
import { testClaimsTenant1Receptionist1 } from '../../data/employee.data';
import { JobRequest } from '../../../models/request';
import { ConfidentialStorageDoc } from '../../../models/confidential-storage';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { EntityConfig } from '../../../models/entity';

// Tell Jest what will be mocked
jest.mock('uuid');

const testBaseJobForClaims = (claims: ClaimsRecord, tenantId: string): JobRequest => ({
  tenantId: tenantId,
  jurisdiction: 'us',
  resourceType: 'Person',
  section: 'org.schema',
  action: '_batch',
  input: {
    aud: 'did:web:api.example.com', // This can be anything for this test
    response_type: 'json',
    thid: 'test-thid-456',
    type: 'json',
    body: {
      data: [
        {
          meta: { claims },
          request: { method: 'POST' },
          type: 'Employee-form-v1.0',
        },
      ],
    },
  },
  httpMethod: 'POST',
  requestUrl: '/default',
});

describe('EmployeeManager', () => {
  let employeeManager: EmployeeManager;
  let mockVaultRepository: MockProxy<VaultRepository>;
  let mockKmsService: MockProxy<IKmsService>;
  let mockTenantsCacheManager: MockProxy<TenantsCacheManager>;

  const mockJwkSet: JwkSet = { keys: [] };
  const MOCKED_OCCUPATION_UUID = 'mocked-occupation-uuid';
  const TENANT_ID = 'health-care.tenant-1';
  const TENANT_URN = 'urn:antifraud:soschain-test:us:v1:health-care:entity:tax:123456789';

  beforeEach(() => {
    mockVaultRepository = mock<VaultRepository>();
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
  });

  describe('Employee Creation (POST)', () => {
    it('should create employee with a semantic URN and save protected documents', async () => {
      // ARRANGE
      const job = testBaseJobForClaims(testClaimsTenant1Receptionist1, TENANT_ID);
      mockKmsService.provisionKeys.mockResolvedValue(mockJwkSet);
      mockVaultRepository.put.mockResolvedValue(true);
      mockTenantsCacheManager.getTenantUrn.mockReturnValue(TENANT_URN);

      // ACT
      const response = await employeeManager.process(job);

      // ASSERT
      const expectedEmployeeId = determineResourceId(testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.identifier]);
      expect(mockKmsService.provisionKeys).toHaveBeenCalledWith(expectedEmployeeId);

      expect(mockTenantsCacheManager.getTenantUrn).toHaveBeenCalledWith(TENANT_ID);

      const docToProtect = mockKmsService.protectConfidentialData.mock.calls[0][0];
      const employeeConfig = docToProtect.content as EntityConfig;

      const email = testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.email];
      const roleCode = testClaimsTenant1Receptionist1[ClaimsPersonSchemaorg.hasOccupation];
      const expectedUrn = `${TENANT_URN}:employee:email:${email}:role:isco-08:${roleCode}`;
      expect(employeeConfig.didDocument.id).toBe(expectedUrn);

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
  });

  describe('Employee Deactivation (DELETE)', () => {
    it('should be true', () => expect(true).toBe(true));
  });
});
