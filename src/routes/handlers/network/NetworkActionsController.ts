// src/routes/handlers/network/NetworkActionsController.ts

import { NextFunction, Request, Response } from 'express';
import { QueueAdapter } from '../../../adapters/queue';
import { createJobName } from '../../../utils/naming';
import { ManagerError } from '../../../models/errors/manager-error';
import { IssueType } from '../../../models/fhir/codes';
import { IKmsService } from '../../../crypto/interfaces/IKmsService';
import { getTenantVaultId } from '../../../utils/tenant';
import { JobRequest } from '../../../models/request';

export class NetworkActionsController {
  private queueAdapter: QueueAdapter;
  private kmsService: IKmsService;

  constructor(queueAdapter: QueueAdapter, kmsService: IKmsService) {
    this.queueAdapter = queueAdapter;
    this.kmsService = kmsService;
  }

  /**
   * Handles a discovery action for a Person resource.
   * This method assumes the `parseCdsRequest` middleware has already run.
   */
  public async discoverPerson(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sector, resourceType, tenantId } = req.cdsRequest!;
      
      if (resourceType !== 'Person') {
        throw new ManagerError(`Discovery action is not supported for resource type '${resourceType}' in this context.`, IssueType.NotSupported);
      }
      
      const decodedJob = await this.kmsService.decodeJobRequest(req.body.request);
      if (!decodedJob.content?.thid) {
        throw new ManagerError('Request payload is missing required "thid".', IssueType.Required);
      }

      const vaultId = getTenantVaultId(sector!, tenantId!);
      const jobName = createJobName(vaultId, resourceType, '_discovery');
      const job: JobRequest = { ...req.cdsRequest!, ...decodedJob };

      await this.queueAdapter.addJob(jobName, job);
      
      const pollingUrl = req.originalUrl;
      res.location(pollingUrl).status(202).json({ thid: decodedJob.content.thid });
    } catch (error) {
      next(error);
    }
  }
}
