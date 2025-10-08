// File: src/__tests__/unit/managers/PingManager.test.ts

import { PingManager } from '../../../managers/PingManager';
import { JobRequest } from '../../../models/request';
import { getBundleResponseTypeForAction } from '../../../utils/bundle';

describe('PingManager', () => {
  let pingManager: PingManager;

  beforeEach(() => {
    pingManager = new PingManager();
  });

  it('should process a ping job and echo the original entry with a success response', async () => {
    // Arrange: Create a mock job request simulating the path:
    // /host/cds-xx/v1/test/ping/standard/resource/_batch
    const mockJob: JobRequest = {
      // --- URL Path Parameters ---
      tenantId: 'host',
      jurisdiction: 'xx',
      sector: 'test',
      section: 'ping',
      format: 'standard',
      resourceType: 'resource',
      action: '_batch',

      // --- Decoded Payload ---
      input: {
        thid: 'test-request-ping-123',
        aud: 'did:web:recipient.example.com',
        iss: 'did:web:requester.example.com',
        response_type: 'json',
        type: 'json',
        body: {
          data: [{
            type: 'ping-form-v1.0',
            meta: { claims: { ping: 'Hello World!' } },
          }],
        },
      },
    };

    // Act: Process the job
    const responsePayload = await pingManager.process(mockJob);

    // Assert: Check the structure and content of the response payload
    expect(responsePayload).toBeDefined();
    expect(responsePayload.thid).toBe('test-request-ping-123');
    expect(responsePayload.aud).toBe('did:web:requester.example.com');
    expect(responsePayload.body.type).toBe(getBundleResponseTypeForAction('_batch'));

    const requestEntry = mockJob.input.body.data[0];
    const responseEntry = responsePayload.body.data[0];

    // The response entry should be the original request entry, with a response block appended
    expect(responseEntry.type).toBe(requestEntry.type);
    expect(responseEntry.meta).toEqual(requestEntry.meta);
    expect(responseEntry.response).toBeDefined();
    expect(responseEntry.response.status).toBe('200');
  });
});
