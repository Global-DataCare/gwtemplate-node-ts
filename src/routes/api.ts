// src/routes/api.ts

// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { QueueAdapter } from '../adapters/queue';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { createDidServiceId } from '../utils/did';
import { createJobName } from '../utils/naming';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel, IssueType } from '../models/fhir/codes';
import { JobRequest } from '../models/request';
import { TenantConfig } from '../models/tenant';
import { IKmsService } from '../security/interfaces/IKmsService';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';

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
    // --- Opaque Acceptance Strategy ---
    const { tenantId, section, resourceType } = req.params;
    const { request } = req.body;

    if (!request) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing "request" parameter in form body.');
      return res.status(400).json(outcome);
    }

    // --- Path and Security Validation (Pre-Queue) ---
    if (section === 'registry' && tenantId !== 'host') {
      return res.status(202).send(); // Silently accept and drop.
    }
    
    const tenantConfig = await tenantsCacheManager.getConfigByAlternateName(tenantId);
    if (!tenantConfig || !isRequestValid(tenantConfig, { ...req.params, action: '_batch' })) {
      return res.status(202).send();
    }

    try {
      // --- Cryptographic Validation ---
      const decodedMessage = await kmsService.decodeRequest(request);
      if (!decodedMessage || !decodedMessage.thid) {
        return res.status(202).send();
      }

      // --- Enqueue Job ---
      const jobName = createJobName(tenantId, resourceType, '_batch');
      const jobRequest: JobRequest = { ...req.params, input: decodedMessage, meta: {} };
      
      await queueAdapter.addJob(jobName, jobRequest);
      asyncResponseStore.set(decodedMessage.thid, { status: 'PENDING' });
      
      return res.status(202).json({ thid: decodedMessage.thid });
    } catch (error: any) {
      console.error(`[API Router Critical Error]: ${error.message}`);
      return res.status(202).send();
    }
  });

  // --- 2. ASYNC JOB POLLING ENDPOINT ---
  router.post(`${cdsRoutePrefix}/_search`, async (req, res) => {
    const { thid } = req.body; // Expect 'thid' parameter from form-urlencoded body
    if (!thid) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing "thid" parameter in form body.');
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
      // Per FAPI, the final response is form-urlencoded.
      res.set('Content-Type', 'application/x-www-form-urlencoded');
      res.status(200).send(`response=${job.result}`);
      asyncResponseStore.delete(thid);
    } else {
      // This could be 'FAILED' or an invalid completed state
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'Job failed to process or result was invalid.');
      res.status(500).json(outcome);
    }
  });

  return router;
}

