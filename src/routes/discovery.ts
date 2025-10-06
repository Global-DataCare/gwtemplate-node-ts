// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { EntityConfig } from '../models/entity';
import { pingHandler } from './handlers/discovery/ping.handler';
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

  // Middleware to resolve the tenant configuration. If no tenantId is in the path,
  // it defaults to 'host'. This allows routes like `/.well-known/ping` to be treated
  // as an alias for `/host/.well-known/ping`.
  const resolveTenant = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tenantId = req.params.tenantId || 'host';
    const vaultId = tenantsCacheManager.getVaultIdByAlternateName(tenantId);

    if (!vaultId) {
      console.warn(`[DiscoveryRouter] Tenant resolution failed: alternateName '${tenantId}' not found in cache.`);
      return res.status(404).type('text').send('Not Found');
    }

    const tenantConfig = await tenantsCacheManager.getConfig(vaultId);
    if (!tenantConfig) {
      // This case is unlikely if getVaultIdByAlternateName returned a vaultId,
      // but it's a safeguard against cache inconsistency.
      console.warn(`[DiscoveryRouter] Tenant resolution failed: vaultId '${vaultId}' for alternateName '${tenantId}' found, but config was missing from cache.`);
      return res.status(404).type('text').send('Not Found');
    }
    
    // Attach the config and resolved tenantId for subsequent handlers.
    res.locals.tenantConfig = tenantConfig;
    res.locals.tenantId = tenantId;
    next();
  };
  
  // --- Route Definitions ---
  // Using "/:tenantId?/" makes the tenantId optional. The resolveTenant middleware handles the default case.
  const wellKnownPrefix = '/:tenantId?/.well-known';

  /**
   * Provides a simple health check and content negotiation demonstration endpoint.
   * It is available for the host and for any valid tenant.
   * @see pingHandler for implementation details.
   */
  router.get(`${wellKnownPrefix}/ping`, resolveTenant, pingHandler);

  router.get(`${wellKnownPrefix}/did.json`, resolveTenant, async (req, res) => {
    const didDocument = await discoveryService.getDidDocument(res.locals.tenantId);
    if (didDocument) {
      res.json(didDocument);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  router.get(`${wellKnownPrefix}/openid-configuration`, resolveTenant, (req, res) => {
    const config = discoveryService.getOpenIdConfiguration(res.locals.tenantConfig);
    res.json(config);
  });

  // --- FHIR-Specific Endpoints ---
  const isFhirSector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tenantConfig: EntityConfig = res.locals.tenantConfig;
    if (tenantConfig && FHIR_SECTORS.includes(tenantConfig.sector)) {
      return next();
    }
    res.status(404).type('text').send('Not Found');
  };

  router.get(`${wellKnownPrefix}/smart-configuration`, resolveTenant, isFhirSector, (req, res) => {
    const config = discoveryService.getSmartConfiguration(res.locals.tenantConfig);
    res.json(config);
  });
  
  // Note: The FHIR metadata endpoint has a different path structure.
  router.get('/:tenantId/fhir/metadata', resolveTenant, isFhirSector, (req, res) => {
    const statement = discoveryService.getCapabilityStatement(res.locals.tenantConfig);
    res.json(statement);
  });

  return router;
}

