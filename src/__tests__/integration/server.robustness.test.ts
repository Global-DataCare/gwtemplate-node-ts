// src/__tests__/integration/server.robustness.test.ts

import request from 'supertest';
import { startServer } from '../../server';
import { Express } from 'express';

describe('Server Robustness', () => {
  let app: Express;
  let server: any; // http.Server

  beforeAll(async () => {
    // Start the server, but without listening to a port, supertest handles that.
    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('Global Error Handler', () => {
    it('should catch malformed JSON and return a 400 Bad Request', async () => {
      // --- Arrange ---
      const malformedJson = '{"key": "value", "anotherKey" "anotherValue"}'; // Missing comma
      const pingUrl = '/host/cds-xx/v1/test/ping/standard/resource/_batch';

      // --- Act ---
      const response = await request(app)
        .post(pingUrl)
        .set('Content-Type', 'application/json')
        .send(malformedJson);

      // --- Assert ---
      expect(response.status).toBe(400);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.body).toBeDefined();
      expect(response.body.resourceType).toBe('OperationOutcome');
      expect(response.body.issue[0].severity).toBe('error');
      expect(response.body.issue[0].code).toBe('invalid');
      expect(response.body.issue[0].diagnostics).toContain('Malformed JSON in request body');
    });
  });
});
