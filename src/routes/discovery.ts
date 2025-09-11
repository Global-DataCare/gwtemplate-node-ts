// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { TenantConfig } from '../models/tenant';

// List of sectors that enable FHIR-specific discovery endpoints, as per SYSTEM_DESIGN.md.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];

/**
 * Creates the router for synchronous, public discovery endpoints.
 * @param tenantsCacheManager The cache manager to resolve tenant configurations.
 * @param discoveryService The service to generate discovery documents.
 * @returns An Express router.
 */
export function createDiscoveryRouter(
  tenantsCacheManager: TenantsCacheManager,
  discoveryService: DiscoveryService
): express.Router {
  const router = express.Router();

  // Middleware to resolve the tenant configuration and attach it to the request.
  const resolveTenant = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // For the host-specific route /.well-known/did.json, tenantId is not in the path.
    const tenantId = req.params.tenantId || 'host';
    const tenantConfig = await tenantsCacheManager.getConfigByAlternateName(tenantId);
    if (!tenantConfig) {
      // Use text/plain for simple errors on public-facing endpoints.
      return res.status(404).type('text').send('Not Found');
    }
    // Attach the config to the response locals for subsequent handlers to use.
    res.locals.tenantConfig = tenantConfig;
    next();
  };

  // --- Core Endpoints ---

  router.get('/:tenantId/.well-known/did.json', resolveTenant, async (req, res) => {
    // The tenantId is already resolved by the middleware.
    const didDocument = await discoveryService.getDidDocument(res.locals.tenantConfig.alternateName);
    if (didDocument) {
      res.json(didDocument);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  
  // Also support host DID without tenantId in path, e.g., /.well-known/did.json
  router.get('/.well-known/did.json', resolveTenant, async (req, res) => {
    const didDocument = await discoveryService.getDidDocument('host');
    if (didDocument) {
      res.json(didDocument);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  router.get('/:tenantId/.well-known/openid-configuration', resolveTenant, (req, res) => {
    const config = discoveryService.getOpenIdConfiguration(res.locals.tenantConfig);
    res.json(config);
  });

  // --- FHIR-Specific Endpoints ---

  // Middleware to check if the tenant's sector is FHIR-enabled.
  const isFhirSector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tenantConfig: TenantConfig = res.locals.tenantConfig;
    // The 'sector' property is assumed to exist on the tenant config for this check.
    if (tenantConfig && FHIR_SECTORS.includes(tenantConfig.sector)) {
      return next();
    }
    res.status(404).type('text').send('Not Found');
  };

  router.get('/:tenantId/.well-known/smart-configuration', resolveTenant, isFhirSector, (req, res) => {
    const config = discoveryService.getSmartConfiguration(res.locals.tenantConfig);
    res.json(config);
  });
  
  router.get('/:tenantId/fhir/metadata', resolveTenant, isFhirSector, (req, res) => {
    const statement = discoveryService.getCapabilityStatement(res.locals.tenantConfig);
    res.json(statement);
  });

  return router;
}
