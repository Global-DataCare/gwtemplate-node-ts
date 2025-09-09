// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import { TenantCacheManager } from '../managers/TenantMemManager';

/**
 * Creates a router for handling synchronous, tenant-specific discovery endpoints 
 * like .well-known configurations.
 * 
 * @param tenantManager A TenantManager instance to resolve tenant information.
 * @returns An Express router instance.
 */
export function createDiscoveryRouter(tenantManager: TenantCacheManager): express.Router {
  const router = express.Router();

  // Endpoint to serve the tenant's full DID Document.
  // Example: GET /org1/.well-known/did.json
  router.get('/:tenantId/.well-known/did.json', async (req, res) => {
    const { tenantId } = req.params;
    const tenantConfig = await tenantManager.getConfigByAlternateName(tenantId);

    if (!tenantConfig || !tenantConfig.didDocument) {
      return res.status(404).json({ error: `DID Document for tenant '${tenantId}' not found.` });
    }

    // FUTURE: Add logic to selectively expose public vs. private parts of the DID document if necessary.
    res.json(tenantConfig.didDocument);
  });

  // Endpoint to serve the tenant's JSON Web Key Set (JWKS).
  // This is crucial for clients to verify signatures.
  // Example: GET /org1/.well-known/jwks.json
  router.get('/:tenantId/.well-known/jwks.json', async (req, res) => {
    const { tenantId } = req.params;
    const tenantConfig = await tenantManager.getConfigByAlternateName(tenantId);

    // The DID Document is the source of truth for cryptographic keys.
    // We extract them from the 'verificationMethod' array.
    if (!tenantConfig || !tenantConfig.didDocument || !Array.isArray(tenantConfig.didDocument.verificationMethod)) {
      return res.status(404).json({ error: `JWKS for tenant '${tenantId}' not found.` });
    }

    // Filter for keys suitable for signing (e.g., assertionMethod) and convert them to JWK format.
    // The `publicKeyJwk` property is assumed to be the JWK representation.
    const keys = tenantConfig.didDocument.verificationMethod
      .filter((vm: any) => vm.publicKeyJwk)
      .map((vm: any) => vm.publicKeyJwk);

    res.json({ keys: keys });
  });

  return router;
}

