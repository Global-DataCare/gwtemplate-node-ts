// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/CommunicationManager.unit.test.ts
// Description: Unit tests for the CommunicationManager.

import { CommunicationManager } from '../../../managers/CommunicationManager';
import { testCommunicationAppointmentFhirR4, testCommMsgExtAppointmentRequest, testAppointmentRequestText } from '../../data/appointment.data';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { DataEntry } from '../../../models/comm';

// Mock the TenantsCacheManager
jest.mock('../../../managers/TenantsCacheManager');

describe('CommunicationManager Unit Tests', () => {
  let communicationManager: CommunicationManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  const testServerDid = 'did:web:test-server.com';

  beforeEach(() => {
    // Create a new mock instance for each test
    mockTenantsCacheManager = new (TenantsCacheManager as jest.Mock<TenantsCacheManager>)() as jest.Mocked<TenantsCacheManager>;
    
    communicationManager = new CommunicationManager({
      tenantsCacheManager: mockTenantsCacheManager,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('convertFhirToCommMsg', () => {
    it('should correctly convert a FHIR Communication resource to a CommMsgExtended object', () => {
      const fhirResource = testCommunicationAppointmentFhirR4;
      const expectedCommMsg = testCommMsgExtAppointmentRequest;
      const testThid = expectedCommMsg.thid;
      
      const result = communicationManager.convertFhirToCommMsg(testThid, testServerDid, fhirResource);

      // --- Assertions for DIDComm properties ---
      expect(result.thid).toEqual(testThid);
      expect(result.to).toEqual(expectedCommMsg.to);
      // The 'from' field should now be the server DID, not the one from the FHIR resource
      expect(result.from).toEqual(testServerDid);
      expect(result).toHaveProperty('id');
      expect(typeof result.id).toBe('string');
      expect(result.created_time).toBeCloseTo(expectedCommMsg.nbf);

      // --- Assertions for body payload ---
      expect(result.body.data).toHaveLength(expectedCommMsg.body.data.length);
      
      // 1. Verify Annotation
      const annotationItem = result.body.data.find((item: DataEntry) => item.type === 'Annotation');
      expect(annotationItem).toBeDefined();
      if(annotationItem) {
        expect(annotationItem.resource.text).toEqual(testAppointmentRequestText);
        expect(typeof annotationItem.id).toBe('string');
      }

      // 2. Verify Reference
      const referenceItem = result.body.data.find((item: DataEntry) => item.type === 'Reference');
      const expectedReference = expectedCommMsg.body.data.find((item: any) => item.type === 'Reference');
      expect(referenceItem).toBeDefined();
      expect(expectedReference).toBeDefined();
      if (referenceItem && expectedReference && expectedReference.resource) {
        expect(referenceItem.resource.reference).toEqual(expectedReference.resource.reference);
        expect(typeof referenceItem.id).toBe('string');
      }

      // 3. Verify Attachment
      const attachmentItem = result.body.data.find((item: DataEntry) => item.type === 'Attachment');
      const expectedAttachment = expectedCommMsg.body.data.find((item: any) => item.type === 'Attachment');
      expect(attachmentItem).toBeDefined();
      expect(expectedAttachment).toBeDefined();
      if (attachmentItem && expectedAttachment && expectedAttachment.resource) {
        expect(attachmentItem.resource.contentType).toEqual(expectedAttachment.resource.contentType);
        expect(attachmentItem.resource.data).toEqual(expectedAttachment.resource.data);
        expect(attachmentItem.resource.title).toEqual(expectedAttachment.resource.title);
        expect(typeof attachmentItem.id).toBe('string');
      }
    });
  });
});
