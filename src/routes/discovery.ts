// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { EntityConfig } from '../models/entity';
import { getTenantVaultId } from '../utils/tenant';
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

  // Middleware to resolve the tenant configuration based on path parameters.
  const resolveTenant = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { sector, tenantId } = req.params;

    // The 'host' is a special case that doesn't have a sector in its path.
    if (tenantId === 'host' || !tenantId) {
      const hostConfig = await tenantsCacheManager.getConfig('host');
      if (!hostConfig) {
        return res.status(503).type('text').send('Service Unavailable: Host configuration not loaded.');
      }
      res.locals.tenantConfig = hostConfig;
      res.locals.tenantId = 'host';
      res.locals.vaultId = 'host';
      return next();
    }

    // For all standard tenants, sector is required to construct the vaultId.
    if (!sector) {
      return res.status(400).type('text').send('Bad Request: The {sector} parameter is required in the URL.');
    }

    const vaultId = getTenantVaultId(sector, tenantId);
    const tenantConfig = await tenantsCacheManager.getConfig(vaultId);

    if (!tenantConfig) {
      console.warn(`[DiscoveryRouter] Tenant not found for vaultId '${vaultId}' constructed from path.`);
      return res.status(404).type('text').send('Not Found');
    }
    
    res.locals.tenantConfig = tenantConfig;
    res.locals.tenantId = tenantId; // The alternateName
    res.locals.vaultId = vaultId; // The full vaultId
    next();
  };
  
  // --- Route Definitions ---
  // Define separate, unambiguous route structures for host and tenants.
  const hostWellKnownPrefix = '/host/.well-known';
  const tenantWellKnownPrefix = '/:jurisdiction/:version/:sector/:tenantId/.well-known';

  router.get([`${hostWellKnownPrefix}/ping`, `${tenantWellKnownPrefix}/ping`], resolveTenant, pingHandler);

  router.get([`${hostWellKnownPrefix}/did.json`, `${tenantWellKnownPrefix}/did.json`], resolveTenant, async (req, res) => {
    const didDocument = await discoveryService.getDidDocument(res.locals.vaultId);
    if (didDocument) {
      res.json(didDocument);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  router.get([`${hostWellKnownPrefix}/openid-configuration`, `${tenantWellKnownPrefix}/openid-configuration`], resolveTenant, (req, res) => {
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

  router.get([`${hostWellKnownPrefix}/smart-configuration`, `${tenantWellKnownPrefix}/smart-configuration`], resolveTenant, isFhirSector, (req, res) => {
    const config = discoveryService.getSmartConfiguration(res.locals.tenantConfig);
    res.json(config);
  });
  
  // Note: The FHIR metadata endpoint uses the full structured path.
  router.get('/:jurisdiction/:version/:sector/:tenantId/fhir/metadata', resolveTenant, isFhirSector, (req, res) => {
    const statement = discoveryService.getCapabilityStatement(res.locals.tenantConfig);
    res.json(statement);
  });
  return router;
}

