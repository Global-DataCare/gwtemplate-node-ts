// src/routes/network.ts

import { Router } from 'express';
import { QueueAdapter } from '../adapters/queue';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { parseCdsRequest } from '../crypto/middleware/parseCdsRequest';
import { NetworkActionsController } from './handlers/network/NetworkActionsController';

export function createNetworkRouter(
  queueAdapter: QueueAdapter,
  kmsService: IKmsService
): Router {
  const router = Router();
  const networkController = new NetworkActionsController(queueAdapter, kmsService);

  router.post(
    '/:tenantId/cds-:jurisdiction/v1/:sector/network/org.schema/Person/_discovery',
    parseCdsRequest, // Use the middleware correctly
    networkController.discoverPerson.bind(networkController)
  );

  return router;
}
