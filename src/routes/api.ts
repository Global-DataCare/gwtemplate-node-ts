// src/routes/api.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { QueueAdapter } from '../adapters/queue';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { createDidServiceId } from '../utils/did';
import { createJobName } from '../utils/naming';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { JobRequest } from '../models/request';
import { TenantConfig } from '../models/tenant';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';

// As per SYSTEM_DESIGN.md, these sectors enable FHIR-specific features.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

/**
 * Validates an incoming request against the dynamic service configuration in a tenant's DID Document.
 * This is the core Policy Enforcement Point for the API.
 * @param tenantConfig The configuration of the tenant being accessed.
 * @param params The parameters extracted from the request URL.
 * @returns True if the request is valid according to a service rule, false otherwise.
 */
function isRequestValid(tenantConfig: TenantConfig, params: any): boolean {
  const { sector, section, format, resourceType, action } = params;

  if (!tenantConfig.didDocument?.service) {
    return false; // No services defined, no access.
  }

  // Construct the expected service ID from the request parameters.
  const expectedServiceId = createDidServiceId({ version: 'v1', sector, section, format });

  // Find a service rule in the tenant's DID document that matches the expected ID.
  const matchingService = tenantConfig.didDocument.service.find((s: { id: string }) => s.id === expectedServiceId);

  if (!matchingService) {
    return false; // No service rule found for this path.
  }

  // Check if the requested resource and action are permitted by the matched rule.
  const resourceAllowed = matchingService.serviceEndpoint.split(',').includes(resourceType);
  const actionAllowed = matchingService.actions.includes(action);

  return resourceAllowed && actionAllowed;
}

/**
 * Creates the main, dynamic API router according to the patterns defined in ARCHITECTURE_PATTERNS.md.
 * @param queueAdapter The queue adapter for adding jobs.
 * @param tenantsCacheManager The tenant manager for validating tenant policies.
 * @param kmsService The KMS for decoding incoming requests.
 * @param asyncResponseStore The in-memory store for async job responses.
 */
export function createApiRouter(
  queueAdapter: QueueAdapter,
  tenantsCacheManager: TenantsCacheManager,
  kmsService: IKmsService,
  asyncResponseStore: IAsyncResponseStore
): express.Router {
  const router = express.Router();

  const cdsRoutePrefix = '/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType';

  // --- 1. ASYNC JOB SUBMISSION ENDPOINT ---
  router.post(`${cdsRoutePrefix}/_batch`, async (req, res) => {
    const { tenantId, section, resourceType } = req.params;
    const contentType = req.headers['content-type'] || '';
    let jobRequest: JobRequest;

    // --- 1. Payload Handling ---
    if (contentType.startsWith('application/x-www-form-urlencoded')) {
      if (!req.body.request) {
        const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, "Missing 'request' parameter in form-encoded body.");
        return res.status(400).json(outcome);
      }
      try {
        jobRequest = await kmsService.decodeJobRequest(req.body.request);
      } catch (error: any) {
        const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Security, 'Failed to decode secure request: ' + error.message);
        return res.status(401).json(outcome);
      }
    } else if (contentType.startsWith('application/json') || contentType.startsWith('application/fhir+json')) {
      // For legacy/developer flow, construct a JobRequest from the plaintext body.
      // The `req.params` are merged to provide the full context to the manager.
      jobRequest = { ...req.params, input: req.body, meta: {} };
    } else {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.NotSupported, `Unsupported Content-Type: ${contentType}`);
      return res.status(415).json(outcome);
    }

    // --- 2. Transaction ID Validation ---
    const thid = jobRequest.input?.thid || jobRequest.input?.id;
    if (!thid) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Request body must contain a "thid" or "id" property.');
      return res.status(400).json(outcome);
    }

    // --- 3. Path and Role Validation ---
    if (section === 'registry' && tenantId !== 'host') {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Forbidden, 'The "registry" section is reserved for the "host" entity.');
      return res.status(403).json(outcome);
    }
    const tenantConfig = await tenantsCacheManager.getConfigByAlternateName(tenantId);
    if (!tenantConfig || !isRequestValid(tenantConfig, { ...req.params, action: '_batch' })) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.NotFound, 'The requested tenant or endpoint path does not exist.');
      return res.status(404).json(outcome);
    }

    // --- 4. Enqueue Job ---
    const jobName = createJobName(tenantId, resourceType, '_batch');
    await queueAdapter.addJob(jobName, jobRequest);
    asyncResponseStore.set(thid, { status: 'PENDING' });

    // --- 5. Success Response ---
    const pollingUrl = req.originalUrl.replace('/_batch', '/_batch-response');
    res.location(pollingUrl);
    return res.status(202).send();
  });

  // --- 2. ASYNC JOB POLLING ENDPOINT ---

  const pollingHandler = async (req: express.Request, res: express.Response) => {
    const thid = (req.method === 'POST' ? req.body.thid : req.query.thid) as string | undefined;

    if (!thid) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing or invalid "thid" parameter.');
      return res.status(400).json(outcome);
    }

    const job = asyncResponseStore.get(thid);
    if (!job) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.NotFound);
      return res.status(404).json(outcome);
    }
    if (job.status === 'PENDING') {
      return res.status(202).json({ thid, status: 'PENDING' });
    }

    if (job.status === 'COMPLETED' && job.result) {
      res.set('Content-Type', 'application/x-www-form-urlencoded');
      res.status(200).send(`response=${job.result}`);
      asyncResponseStore.delete(thid);
    } else {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'Job failed to process or result was invalid.');
      res.status(500).json(outcome);
    }
  };

  const isFhirSector = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tenantConfig = await tenantsCacheManager.getConfigByAlternateName(req.params.tenantId);
    if (tenantConfig && tenantConfig.alternateName !== 'host' && FHIR_SECTORS.includes(tenantConfig.sector)) {
      return next();
    }
    const outcome = createOperationOutcome(IssueLevel.Error, IssueType.NotSupported, 'GET polling is not supported for this entity.');
    return res.status(405).json(outcome);
  };

  router.post(`${cdsRoutePrefix}/_batch-response`, pollingHandler);
  router.get(`${cdsRoutePrefix}/_batch-response`, isFhirSector, pollingHandler);

  return router;
}