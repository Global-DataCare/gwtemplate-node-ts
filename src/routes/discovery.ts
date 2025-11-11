// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { DiscoveryService } from '../services/DiscoveryService';
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
  const router = express.default.Router();

  // Middleware to resolve the tenant vaultId based on path parameters and verify existence.
  const resolveTenant = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const { tenantId, jurisdiction, version, sector } = req.params;

    // The 'host' is a special case that doesn't use the structured CDS path.
    if (req.path.startsWith('/host')) {
      res.locals.vaultId = 'host';
      // Quick check to ensure host is loaded before proceeding.
      if (!(await tenantsCacheManager.getDidDocument('host'))) {
        return res.status(503).type('text').send('Service Unavailable: Host configuration not loaded.');
      }
      return next();
    }

    // For all standard tenants, all parts of the CDS path are required.
    if (!tenantId || !jurisdiction || !version || !sector) {
      return res.status(400).type('text').send('Bad Request: A valid CDS path is required.');
    }

    const vaultId = getTenantVaultId(sector, tenantId);
    
    // Use the public getDidDocument method to check for the tenant's existence.
    // This avoids exposing the entire internal EntityConfig in the middleware.
    const didDocument = await tenantsCacheManager.getDidDocument(vaultId);

    if (!didDocument) {
      console.warn(`[DiscoveryRouter] Tenant not found for vaultId '${vaultId}' constructed from path.`);
      return res.status(404).type('text').send('Not Found');
    }
    
    res.locals.vaultId = vaultId; // Pass the resolved vaultId to the next handler.
    next();
  };
  
  // --- Route Definitions ---
  // Define separate, unambiguous route structures for host and tenants.
  const hostWellKnownPrefix = '/host/.well-known';
  // This new route aligns with the hosted DID web specification for tenants.
  const tenantWellKnownPrefix = '/:tenantId/cds-:jurisdiction/:version/:sector/.well-known';

  router.get([`${hostWellKnownPrefix}/ping`, `${tenantWellKnownPrefix}/ping`], resolveTenant, pingHandler());

  router.get([`${hostWellKnownPrefix}/did.json`, `${tenantWellKnownPrefix}/did.json`], resolveTenant, async (req, res) => {
    // The final handler's responsibility is to fetch the specific document it needs.
    const didDocument = await tenantsCacheManager.getDidDocument(res.locals.vaultId);
    // The existence check was already done in resolveTenant, so we can be confident it exists.
    res.json(didDocument);
  });

  router.get([`${hostWellKnownPrefix}/openid-configuration`, `${tenantWellKnownPrefix}/openid-configuration`], resolveTenant, (req, res) => {
    const config = discoveryService.getOpenIdConfiguration(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  // --- FHIR-Specific Endpoints ---
  const isFhirSector = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sector = await tenantsCacheManager.getTenantSector(res.locals.vaultId);
    if (sector && FHIR_SECTORS.includes(sector)) {
      return next();
    }
    res.status(404).type('text').send('Not Found');
  };

  router.get([`${hostWellKnownPrefix}/smart-configuration`, `${tenantWellKnownPrefix}/smart-configuration`], resolveTenant, isFhirSector, (req, res) => {
    const config = discoveryService.getSmartConfiguration(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  
  // Note: The FHIR metadata endpoint uses the full structured path.
  router.get('/:tenantId/cds-:jurisdiction/:version/:sector/fhir/metadata', resolveTenant, isFhirSector, (req, res) => {
    const statement = discoveryService.getCapabilityStatement(res.locals.vaultId);
    if (statement) {
      res.json(statement);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  return router;
}
