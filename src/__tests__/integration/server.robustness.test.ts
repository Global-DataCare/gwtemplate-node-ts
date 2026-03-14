// src/__tests__/integration/server.robustness.test.ts

import { createGlobalErrorHandler } from '../../middlewares/global-error-handler';
import { ConsoleLogger } from '../../loggers/ConsoleLogger';

describe('Server Robustness', () => {
  describe('Global Error Handler', () => {
    it('should catch malformed JSON and return a 400 Bad Request', async () => {
      const logger = new ConsoleLogger();
      const handler = createGlobalErrorHandler(logger);

      const err = new SyntaxError('Unexpected token } in JSON at position 10');
      (err as any).body = '{"broken": }'; // Body-parser marks the error with a `body` property.

      const req = { path: '/host/cds-xx/v1/test/ping/standard/resource/_batch', method: 'POST' } as any;

      let statusCode = 200;
      let jsonBody: any;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: any) {
          jsonBody = payload;
          return this;
        },
      } as any;

      handler(err as any, req, res, () => undefined);

      expect(statusCode).toBe(400);
      expect(jsonBody).toBeDefined();
      expect(jsonBody.type).toBe('application/bundle-api+json');
      expect(jsonBody.body.resourceType).toBe('Bundle');
      expect(jsonBody.body.data).toEqual([]);
      expect(jsonBody.body.total).toBe(0);
      expect(jsonBody.body.issues.issue[0].severity).toBe('error');
      expect(jsonBody.body.issues.issue[0].code).toBe('invalid');
      expect(jsonBody.body.issues.issue[0].diagnostics).toContain('Malformed JSON in request body');
    });
  });
});
