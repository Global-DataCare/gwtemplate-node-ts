// src/routes/api.ts

// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { QueueAdapter } from '@/adapters/queue';
import { TenantCacheManager } from '@/managers/TenantMemManager';
import { createDidServiceId } from '@/utils/did';
import { createJobName } from '@/utils/naming';

import { JobRequest } from '@/models/request';
import { TenantConfig } from '@/models/tenant';
import { IKmsService } from '@/security/interfaces/IKmsService';
import { IAsyncResponseStore } from '@/adapters/async-response-store.mem';

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
 * @param tenantManager The tenant manager for validating tenant policies.
 * @param kmsService The KMS for decoding incoming requests.
 * @param asyncResponseStore The in-memory store for async job responses.
 */
export function createApiRouter(
  queueAdapter: QueueAdapter,
  tenantManager: TenantCacheManager,
  kmsService: IKmsService,
  asyncResponseStore: IAsyncResponseStore
): express.Router {
  const router = express.Router();

  const cdsRoutePrefix = '/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType';

  // --- 1. ASYNC JOB SUBMISSION ENDPOINT ---
  router.post(`${cdsRoutePrefix}/_batch`, async (req, res) => {
    const { tenantId, resourceType } = req.params;
    const { request } = req.body; // Expect 'request' parameter from form-urlencoded body

    if (!request) {
      return res.status(400).json({ error: 'Bad Request: Missing "request" parameter in form body.' });
    }

    const tenantConfig = await tenantManager.getConfigByAlternateName(tenantId);
    if (!tenantConfig) {
      return res.status(404).json({ error: `Tenant '${tenantId}' not found.` });
    }

    if (!isRequestValid(tenantConfig, { ...req.params, action: '_batch' })) {
      return res.status(404).json({ error: `The requested endpoint is not configured for this tenant.` });
    }

    try {
      const decodedMessage = await kmsService.decodeRequest(request);
      if (!decodedMessage || !decodedMessage.thid) {
        return res.status(400).json({ error: 'Bad Request: Missing or invalid "thid" in decoded message payload.' });
      }

      const jobName = createJobName(tenantId, resourceType, '_batch');
      const jobRequest: JobRequest = { ...req.params, input: decodedMessage, meta: {} };

      await queueAdapter.addJob(jobName, jobRequest);
      asyncResponseStore.set(decodedMessage.thid, { status: 'PENDING' });

      res.status(202).json({
        thid: decodedMessage.thid
      });
    } catch (error: any) {
      console.error(`[API Router Error processing request: ${error.message}`);
      if (error.message.includes('Failed to parse')) {
        return res.status(400).json({ error: 'Bad Request: Malformed payload.' });
      }
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  // --- 2. ASYNC JOB POLLING ENDPOINT ---
  router.post(`${cdsRoutePrefix}/_search`, async (req, res) => {
    const { thid } = req.body; // Expect 'thid' parameter from form-urlencoded body
    if (!thid) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing "thid" parameter in form body.' });
    }

    const job = asyncResponseStore.get(thid);
    if (!job) {
      return res.status(404).json({ error: 'Thread ID not found or expired.' });
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
      res.status(500).json({ error: 'Job failed to process or result was invalid.' });
    }
  });

  return router;
}
