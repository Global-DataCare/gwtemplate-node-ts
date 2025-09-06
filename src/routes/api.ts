// src/routes/api.ts
// src/routes/api.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { QueueAdapter } from '../adapters/queue';
import { TenantMemManager } from '../managers/TenantMemManager';
import { TenantConfig } from '../managers/ITenantManager';
import { createDidServiceId } from '../utils/did';
import { createJobName } from '../utils/naming';
import { JobRequest } from '../models/request';

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
  const matchingService = tenantConfig.didDocument.service.find(s => s.id === expectedServiceId);

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
 */
export function createApiRouter(queueAdapter: QueueAdapter, tenantManager: TenantMemManager): express.Router {
  const router = express.Router();

  router.post('/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType/:action', async (req, res) => {
    // --- STANDARD ASYNC JOB FLOW ---
    const { tenantId, resourceType, action } = req.params;

    // --- 1. TENANT & POLICY VALIDATION ---
    const tenantConfig = tenantManager.getConfigByAlternateName(tenantId);
    if (!tenantConfig) {
      return res.status(404).json({ error: `Tenant '${tenantId}' not found.` });
    }

    if (!isRequestValid(tenantConfig, req.params)) {
      // This is a critical security check. If no rule in the tenant's config matches the request, deny it.
      return res.status(404).json({ error: `The requested endpoint is not configured for this tenant.` });
    }

    // FUTURE: Add JWS/JWE decoding and authorization logic here.

    // 2. Job Request Creation
    const messageId = uuidv4(); // This is the DIDComm message ID

    // Use the new canonical function to create the job name.
    const jobName = createJobName(tenantId, resourceType, action);
    const jobRequest: JobRequest = {
      // The JobRequest gets the context from the URL
      ...req.params,
      // The input is the decoded DIDComm message
      input: {
        thid: messageId,
        type: 'didcomm-message-type', // This would be the DIDComm protocol type
        body: req.body,
      },
      meta: {}
    };

    // 3. Queue Job & Respond
    try {
      await queueAdapter.addJob(jobName, jobRequest);
      // The response body contains the messageId (thid) needed for polling.
      res.status(202).json({
        message: 'Request accepted for processing.',
        thid: messageId
      });
    } catch (error) {
      console.error(`[API Router Failed to add job '${jobName}' to queue`, error);
      res.status(500).json({ error: 'Internal server error while queueing job.' });
    }
  });

  return router;
}

