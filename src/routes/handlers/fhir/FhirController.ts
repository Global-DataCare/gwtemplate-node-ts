// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/routes/handlers/fhir/FhirController.ts

import { Request, Response, Router } from 'express';
import { container, injectable } from 'tsyringe';
import { IAuthorizationManager } from '../../../managers/auth/IAuthorizationManager';
import { QueueAdapter } from '../../../adapters/queue';
import { IAccessTokenClaims } from '../../../models/auth';
import { JobRequest } from '../../../models/request';
import { createOperationOutcome } from '../../../utils/outcome';
import { IssueLevel, IssueType } from '../../../models/fhir/codes';
import { validOrNewUuidv4 } from '../../../utils/uuid';
import { v4 as uuidv4 } from 'uuid';

@injectable()
export class FhirController {
  private readonly authManager: IAuthorizationManager;
  private readonly queueAdapter: QueueAdapter;

  constructor(queueAdapter: QueueAdapter) {
    this.authManager = container.resolve<IAuthorizationManager>('AuthorizationManager');
    this.queueAdapter = queueAdapter;
  }

  /**
   * Handles the creation of a FHIR Communication resource.
   * It performs authorization checks before enqueuing the job for processing.
   */
  public async createCommunication(req: Request, res: Response): Promise<Response> {
    const resource = req.body;
    const accessTokenClaims = (req as any).claims as IAccessTokenClaims; // Assuming claims are populated by upstream middleware

    // 1. Validate 'partOf' exists
    const partOf = resource.partOf?.[0]?.reference;
    if (!partOf) {
      const outcome = createOperationOutcome(
        IssueLevel.Error,
        IssueType.Required,
        "The 'partOf' field is required to link this communication to a consent.",
      );
      return res.status(400).json(outcome);
    }

    const consentId = partOf;

    // 2. Perform authorization check
    const isAuthorized = await this.authManager.canAccess(accessTokenClaims, { resource: resource } as any, 'create', consentId);
    if (!isAuthorized) {
      const outcome = createOperationOutcome(
        IssueLevel.Error,
        IssueType.Forbidden,
        'The provided credentials do not grant permission to perform this action.',
      );
      return res.status(403).json(outcome);
    }

    // 3. If authorized, create and enqueue the job
    const thid = validOrNewUuidv4(resource.id);
    const job: JobRequest = {
      action: 'create',
      resourceType: 'Communication',
      tenantId: accessTokenClaims.iss, 
      sector: req.params.sector,
      content: {
        type: 'https://didcomm.org/fhir/v1.0/Communication',
        thid: thid,
        aud: accessTokenClaims.iss, // The message is intended for the tenant itself to process
        body: {
          resource: resource
        }
      },
      meta: {
        bearer: { jwt: { payload: accessTokenClaims } }
      }
    };

    await this.queueAdapter.addJob('Communication', job);

    const location = `${req.protocol}://${req.get('host')}${req.originalUrl}/${thid}`;
    return res.status(202).location(location).send();
  }

  /**
   * Registers the routes for the FHIR controller.
   * @param router The express router to register the routes on.
   */
  public register(router: Router): void {
    router.post(
      '/v1/:sector/individual/org.hl7.fhir.r4/Communication',
      this.createCommunication.bind(this),
    );
  }
}
