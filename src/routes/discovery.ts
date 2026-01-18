// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { getTenantVaultId } from '../utils/tenant';
import { pingHandler } from './handlers/discovery/ping.handler';
import { signVerifiableCredential } from '../utils/vc-signer';
import { findSigningMethod } from '../utils/did-backend';
import { buildStatusListCredential, buildStatusListEntry, createStatusListEncodedList } from '../utils/status-list';

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ILogger } from '../loggers/ILogger';

// List of sectors that enable FHIR-specific discovery endpoints, as per SYSTEM_DESIGN.md.
const FHIR_SECTORS = ['health-care', 'emergency', 'health-insurance'];
const STATUS_LIST_BITS = 16384;
const STATUS_LIST_PURPOSE = 'revocation' as const;
const STATUS_LIST_INDEX = 0;

/**
 * Creates the router for synchronous, public discovery endpoints.
 * @param tenantsCacheManager The cache manager to resolve tenant configurations.
 * @param discoveryService The service to generate discovery documents.
 * @param kmsService The service to retrieve cryptographic keys.
 * @param logger The logging service.
 * @returns An Express router.
 */
export function createDiscoveryRouter(
  tenantsCacheManager: TenantsCacheManager,
  discoveryService: DiscoveryService,
  kmsService: IKmsService,
  logger: ILogger,
): express.Router {
  const router = express.Router();

  /**
   * @openapi
   * /host/.well-known/ping:
   *   get:
   *     tags: [Discovery]
   *     summary: Ping (host)
   *     description: Health check for the host tenant.
   *     responses:
   *       '200': { description: OK }
   *       '503': { description: Service Unavailable }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/ping:
   *   get:
   *     tags: [Discovery]
   *     summary: Ping (tenant)
   *     description: Health check for a tenant resolved by its CDS path.
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/.well-known/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DID document (host)
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/did.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DID document (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/.well-known/jwks.json:
   *   get:
   *     tags: [Discovery]
   *     summary: JWKS (host)
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/jwks.json:
   *   get:
   *     tags: [Discovery]
   *     summary: JWKS (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/.well-known/openid-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: OpenID configuration (host)
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/openid-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: OpenID configuration (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/.well-known/smart-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: SMART configuration (host)
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/smart-configuration:
   *   get:
   *     tags: [Discovery]
   *     summary: SMART configuration (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /host/.well-known/legal-participant.vc.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Gaia-X Legal Participant VC (host)
   *     responses:
   *       '200': { description: OK }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/legal-participant.vc.json:
   *   get:
   *     tags: [Discovery]
   *     summary: Gaia-X Legal Participant VC (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/fhir/metadata:
   *   get:
   *     tags: [Discovery]
   *     summary: FHIR CapabilityStatement (tenant)
   *     description: Returns the tenant's FHIR capability statement for supported sectors.
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   */

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

  router.get([`${hostWellKnownPrefix}/jwks.json`, `${tenantWellKnownPrefix}/jwks.json`], resolveTenant, async (req, res) => {
    try {
      const vaultId = res.locals.vaultId;
      const jwks = await kmsService.getPublicJwks(vaultId);
      const entityConfig = await tenantsCacheManager.getTenant(vaultId);
      const legacySignAlg = (entityConfig?.legacyX509DerBase64 || entityConfig?.legacyX509ChainBase64?.length)
        ? (entityConfig?.legacySignAlg || process.env.LEGACY_SIGN_ALG)
        : undefined;
      const legacyX5c = entityConfig?.legacyX509ChainBase64;
      const legacyDerBase64 = entityConfig?.legacyX509DerBase64;
      if (legacySignAlg && legacyDerBase64 && jwks?.keys?.length) {
        const wellKnownBase = vaultId === 'host'
          ? hostWellKnownPrefix
          : `/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/.well-known`;
        const legacyX5u = `${req.protocol}://${req.get('host')}${wellKnownBase}/x509.der`;
        const combinedChain = legacyDerBase64
          ? [legacyDerBase64, ...(legacyX5c || [])]
          : (legacyX5c || []);
        const uniqueChain = combinedChain.filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
        for (const key of jwks.keys) {
          if ((key as any).alg === legacySignAlg) {
            (key as any).x5u = legacyX5u;
            if (uniqueChain.length) {
              (key as any).x5c = uniqueChain;
            }
          }
        }
      }
      res.json(jwks);
    } catch (error) {
      // If keys are not found for the entity, it's a server-side issue.
      logger.error('Failed to get JWKS', error as Error, { vaultId: res.locals.vaultId });
      res.status(500).type('text').send('Internal Server Error: Could not retrieve key set.');
    }
  });

  router.get([`${hostWellKnownPrefix}/x509.der`, `${tenantWellKnownPrefix}/x509.der`], resolveTenant, async (req, res) => {
    const vaultId = res.locals.vaultId;
    const entityConfig = await tenantsCacheManager.getTenant(vaultId);
    const derBase64 = entityConfig?.legacyX509DerBase64;
    const chainBase64 = entityConfig?.legacyX509ChainBase64 || [];
    const combined = derBase64 ? [derBase64, ...chainBase64] : chainBase64;
    const uniqueChain = combined.filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
    if (!uniqueChain.length) {
      return res.status(404).type('text').send('Not Found');
    }
    const derBuffers = uniqueChain.map((entry: string) => Buffer.from(entry, 'base64'));
    const derBytes = Buffer.concat(derBuffers);
    res.type('application/pkix-cert').send(derBytes);
  });

  // Legacy/dev-friendly: return the tenant's stored legal-participant VC and self-description (if present).
  // Some clients rely on vc.json; serve it as a deprecated alias.
  router.get([`${hostWellKnownPrefix}/vc.json`, `${tenantWellKnownPrefix}/vc.json`], resolveTenant, async (req, res) => {
    const entityConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const vc = entityConfig?.governanceVc;
    if (!vc) return res.status(404).type('text').send('Not Found');
    res.json(vc);
  });

  router.get(
    [`${hostWellKnownPrefix}/self-description.json`, `${tenantWellKnownPrefix}/self-description.json`],
    resolveTenant,
    async (req, res) => {
      const entityConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
      const selfDescription = entityConfig?.selfDescriptionVc;
      if (!selfDescription) return res.status(404).type('text').send('Not Found');
      res.json(selfDescription);
    },
  );

  router.get([`${hostWellKnownPrefix}/status-list.json`, `${tenantWellKnownPrefix}/status-list.json`], resolveTenant, async (req, res) => {
    try {
      const vaultId = res.locals.vaultId;
      const entityConfig = await tenantsCacheManager.getTenant(vaultId);
      const didDoc = entityConfig?.didDocument;
      if (!entityConfig || !didDoc) {
        return res.status(404).type('text').send('Not Found');
      }

      const legacySignAlg = (entityConfig?.legacyX509DerBase64 || entityConfig?.legacyX509ChainBase64?.length)
        ? (entityConfig?.legacySignAlg || process.env.LEGACY_SIGN_ALG)
        : undefined;
      const verificationMethodId = findSigningMethod(didDoc, legacySignAlg) || (didDoc.assertionMethod?.[0] as string);
      const pqcSignMethod = didDoc.verificationMethod?.find((method: any) => (method.publicKeyJwk as any)?.alg?.startsWith('ML-DSA'))?.id as string | undefined;
      const pqcSignAlg = pqcSignMethod
        ? (didDoc.verificationMethod?.find((method: any) => method.id === pqcSignMethod)?.publicKeyJwk as any)?.alg
        : undefined;
      if (!verificationMethodId && !pqcSignMethod) {
        throw new Error('No assertionMethod found in DID document to sign the status list.');
      }

      const wellKnownBase = vaultId === 'host'
        ? hostWellKnownPrefix
        : `/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/.well-known`;
      const listUrl = `${req.protocol}://${req.get('host')}${wellKnownBase}/status-list.json`;
      const encodedList = createStatusListEncodedList(STATUS_LIST_BITS);

      const unsignedStatusListVc = buildStatusListCredential({
        issuerDid: didDoc.id,
        listUrl,
        statusPurpose: STATUS_LIST_PURPOSE,
        encodedList,
      });

      let signedStatusListVc = unsignedStatusListVc;
      if (verificationMethodId) {
        signedStatusListVc = await signVerifiableCredential(
          signedStatusListVc,
          verificationMethodId,
          kmsService,
          vaultId,
          { signerAlg: legacySignAlg },
        );
      }
      if (pqcSignMethod && pqcSignMethod !== verificationMethodId) {
        signedStatusListVc = await signVerifiableCredential(
          signedStatusListVc,
          pqcSignMethod,
          kmsService,
          vaultId,
          { signerAlg: pqcSignAlg },
        );
      }

      res.json(signedStatusListVc);
    } catch (error: any) {
      console.error(`[DiscoveryRouter] Failed to generate Status List VC for vaultId '${res.locals.vaultId}':`, error);
      res.status(500).type('text').send('Internal Server Error: ' + error.message);
    }
  });

  router.get([`${hostWellKnownPrefix}/legal-participant.vc.json`, `${tenantWellKnownPrefix}/legal-participant.vc.json`], resolveTenant, async (req, res) => {
    const entityConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const vc = entityConfig?.governanceVc;
    if (!vc) return res.status(404).type('text').send('Not Found');
    res.json(vc);
  });

  router.get([`${hostWellKnownPrefix}/openid-configuration`, `${tenantWellKnownPrefix}/openid-configuration`], resolveTenant, (req, res) => {
    const config = discoveryService.getOpenIdConfiguration(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });

  router.get([`${hostWellKnownPrefix}/openid-credential-issuer`, `${tenantWellKnownPrefix}/openid-credential-issuer`], resolveTenant, async (req, res) => {
    const config = await discoveryService.getOpenIdCredentialIssuerMetadata(res.locals.vaultId);
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
