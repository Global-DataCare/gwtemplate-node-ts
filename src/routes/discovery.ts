// src/routes/discovery.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import * as express from 'express';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { DiscoveryService } from '../services/DiscoveryService';
import { getTenantVaultId } from '../utils/tenant';
import { pingHandler } from './handlers/discovery/ping.handler';
import { signVerifiableCredential } from '../utils/vc-signer';
import { findSigningMethod } from '../utils/did-backend';
import { buildStatusListCredential, buildStatusListEntry, createStatusListEncodedList } from '../utils/status-list';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  getServiceCapabilityFamily,
  hasServiceCapabilityFamily,
  parseServiceCapabilityTokens,
  ServiceCapabilityFamily,
  ServiceCapabilityTokenValue,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import { getBaseUrlFromDidWeb } from '../utils/did-backend';
import { isFhirSector, isResearchSector } from '../utils/sector';

import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ILogger } from '../loggers/ILogger';
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
  const toDatasetId = (publisherDid: string): string => encodeURIComponent(publisherDid);

  type ProviderDataset = {
    datasetId: string;
    publisherDid: string;
    title: string;
    baseUrl: string;
    operationalUrl: string;
    alternateName?: string;
    sector?: string;
    jurisdiction?: string;
    serviceTypeClaim?: string;
  };

  type ServiceOfferingKind = 'index' | 'research';

  type ProviderServiceOffering = {
    id: string;
    kind: ServiceOfferingKind;
    publisherDid: string;
    title: string;
    endpointUrl: string;
    sector?: string;
    jurisdiction?: string;
    serviceTypes: ServiceCapabilityTokenValue[];
  };

  const parseCategory = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const first = value.split(',')[0]?.trim() || '';
    return first;
  };

  const parseJurisdiction = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase();
  };

  const toProviderDataset = (tenantConfig: any): ProviderDataset | null => {
    const publisherDid = tenantConfig?.didDocument?.id as string | undefined;
    if (!publisherDid) return null;
    const title =
      (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.legalName] as string | undefined) ||
      (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.name] as string | undefined) ||
      (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined) ||
      publisherDid;
    const baseUrl = getBaseUrlFromDidWeb(publisherDid);
    const operationalUrl =
      (tenantConfig?.claims?.[ClaimsServiceSchemaorg.url] as string | undefined)?.trim() ||
      baseUrl;
    const alternateName = (tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.alternateName] as string | undefined)?.trim();
    const sector = parseCategory(tenantConfig?.claims?.[ClaimsServiceSchemaorg.category]);
    const jurisdiction = parseJurisdiction(tenantConfig?.claims?.[ClaimsOrganizationSchemaorg.addressCountry]);
    const serviceTypeClaim = tenantConfig?.claims?.[ClaimsServiceSchemaorg.serviceType] as string | undefined;
    return {
      datasetId: toDatasetId(publisherDid),
      publisherDid,
      title,
      baseUrl,
      operationalUrl,
      alternateName,
      sector,
      jurisdiction,
      serviceTypeClaim,
    };
  };

  const buildTenantContextPath = (dataset: ProviderDataset): string | undefined => {
    if (!dataset.alternateName || !dataset.sector || !dataset.jurisdiction) {
      return undefined;
    }
    return `/${dataset.alternateName}/cds-${dataset.jurisdiction.toLowerCase()}/v1/${dataset.sector}`;
  };

  const buildServiceOfferingUrl = (
    publicOrigin: string,
    dataset: ProviderDataset,
    kind: ServiceOfferingKind,
  ): string => {
    const contextualPath = buildTenantContextPath(dataset);
    if (contextualPath) {
      return `${publicOrigin}${contextualPath}/.well-known/service-offering-${kind}.json`;
    }
    return `${dataset.baseUrl}/.well-known/service-offering-${kind}.json`;
  };

  const buildServiceOfferingTypeLabel = (kind: ServiceOfferingKind): string =>
    kind === 'index' ? 'Index' : 'Research Digital Twin';

  const resolveDefaultOfferingKinds = (dataset: ProviderDataset): ServiceOfferingKind[] => {
    const kinds: ServiceOfferingKind[] = ['index'];
    if (dataset.sector && isResearchSector(dataset.sector as any)) {
      kinds.push('research');
    }
    return kinds;
  };

  const buildServiceOfferings = (
    dataset: ProviderDataset,
    publicOrigin: string,
  ): ProviderServiceOffering[] => {
    const explicitCapabilityClaim = String(dataset.serviceTypeClaim || '').trim();
    const explicitTokens = parseServiceCapabilityTokens(explicitCapabilityClaim) as ServiceCapabilityTokenValue[];
    const kinds: ServiceOfferingKind[] = explicitTokens.length > 0
      ? [
          ...(hasServiceCapabilityFamily(explicitCapabilityClaim, ServiceCapabilityFamily.Indexing) ? ['index' as const] : []),
          ...(hasServiceCapabilityFamily(explicitCapabilityClaim, ServiceCapabilityFamily.DigitalTwin) ? ['research' as const] : []),
        ]
      : resolveDefaultOfferingKinds(dataset);

    return kinds.map((kind) => {
      const family = kind === 'index' ? ServiceCapabilityFamily.Indexing : ServiceCapabilityFamily.DigitalTwin;
      const serviceTypes = explicitTokens.filter((token) => getServiceCapabilityFamily(token) === family);
      return {
        id: buildServiceOfferingUrl(publicOrigin, dataset, kind),
        kind,
        publisherDid: dataset.publisherDid,
        title: `${dataset.title} ${buildServiceOfferingTypeLabel(kind)} Service Offering`,
        endpointUrl: dataset.operationalUrl,
        sector: dataset.sector,
        jurisdiction: dataset.jurisdiction,
        serviceTypes,
      };
    });
  };

  const toServiceOfferingNode = (offering: ProviderServiceOffering) => ({
    '@id': offering.id,
    '@type': 'dcat:DataService',
    'dcterms:title': offering.title,
    'dcterms:publisher': { '@id': offering.publisherDid },
    'dcat:endpointURL': offering.endpointUrl,
    'dcat:theme': offering.sector || undefined,
    'dcterms:spatial': offering.jurisdiction || undefined,
    'dcat:keyword': offering.serviceTypes.length ? offering.serviceTypes : undefined,
  });

  const buildCatalog = (catalogBaseUrl: string, publicOrigin: string, datasets: ProviderDataset[]) => ({
    '@context': {
      dcat: 'https://www.w3.org/ns/dcat#',
      dcterms: 'http://purl.org/dc/terms/',
      odrl: 'http://www.w3.org/ns/odrl/2/',
    },
    '@id': `${catalogBaseUrl}`,
    '@type': 'dcat:Catalog',
    'dcat:service': datasets.flatMap((dataset) => buildServiceOfferings(dataset, publicOrigin).map(toServiceOfferingNode)),
    'dcat:dataset': datasets.map((dataset) => ({
      '@id': `${catalogBaseUrl}/datasets/${dataset.datasetId}`,
      '@type': 'dcat:Dataset',
      'dcterms:title': dataset.title,
      'dcterms:identifier': dataset.datasetId,
      'dcterms:publisher': { '@id': dataset.publisherDid },
      'dcat:theme': dataset.sector || undefined,
      'dcterms:spatial': dataset.jurisdiction || undefined,
      'dcat:service': buildServiceOfferings(dataset, publicOrigin).map((offering) => ({ '@id': offering.id })),
      'dcat:distribution': [
        {
          '@type': 'dcat:Distribution',
          'dcat:accessURL': `${dataset.baseUrl}/.well-known/did.json`,
        },
      ],
      'odrl:hasPolicy': {
        '@type': 'odrl:Set',
      },
    })),
  });

  const filterDatasets = (datasets: ProviderDataset[], filters: any): ProviderDataset[] => {
    if (!filters || typeof filters !== 'object') return datasets;
    const sectorFilter = typeof filters.sector === 'string' ? filters.sector.toLowerCase() : '';
    const jurisdictionFilter = typeof filters.jurisdiction === 'string' ? filters.jurisdiction.toUpperCase() : '';
    return datasets.filter((dataset) => {
      if (sectorFilter && (dataset.sector || '').toLowerCase() !== sectorFilter) return false;
      if (jurisdictionFilter && (dataset.jurisdiction || '').toUpperCase() !== jurisdictionFilter) return false;
      return true;
    });
  };

  const buildServiceOfferingArtifact = (
    dataset: ProviderDataset,
    kind: ServiceOfferingKind,
    publicOrigin: string,
  ) => {
    const offering = buildServiceOfferings(dataset, publicOrigin).find((candidate) => candidate.kind === kind);
    if (!offering) return undefined;
    return {
      '@context': {
        dcat: 'https://www.w3.org/ns/dcat#',
        dcterms: 'http://purl.org/dc/terms/',
      },
      ...toServiceOfferingNode(offering),
    };
  };

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
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-index.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DCAT3 index service offering (tenant)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: OK }
   *       '404': { description: Not Found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-research.json:
   *   get:
   *     tags: [Discovery]
   *     summary: DCAT3 research service offering (tenant)
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

  router.get(`${tenantWellKnownPrefix}/service-offering-index.json`, resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = tenantConfig ? toProviderDataset(tenantConfig) : null;
    const artifact = dataset ? buildServiceOfferingArtifact(dataset, 'index', `${req.protocol}://${req.get('host')}`) : undefined;
    if (!artifact) return res.status(404).type('text').send('Not Found');
    res.json(artifact);
  });

  router.get(`${tenantWellKnownPrefix}/service-offering-research.json`, resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    const dataset = tenantConfig ? toProviderDataset(tenantConfig) : null;
    const artifact = dataset ? buildServiceOfferingArtifact(dataset, 'research', `${req.protocol}://${req.get('host')}`) : undefined;
    if (!artifact) return res.status(404).type('text').send('Not Found');
    res.json(artifact);
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

  /**
   * @openapi
   * /dcat3/catalog/request:
   *   post:
   *     tags: [Data Catalog Discovery]
   *     summary: Operator catalog request (DSP/DCAT-3)
   *     description: Returns a `dcat:Catalog` with provider datasets discoverable by client apps.
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               filters:
   *                 type: object
   *                 properties:
   *                   sector: { type: string }
   *                   jurisdiction: { type: string }
   *     responses:
   *       '200': { description: DSP catalog response }
   *       '503': { description: Host not available }
   *
   * /dcat3/catalog/dcat.json:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Operator catalog artifact (DCAT-3)
   *     responses:
   *       '200': { description: DCAT catalog artifact }
   *       '503': { description: Host not available }
   *
   * /dcat3/catalog/datasets/{id}:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Read one provider dataset from operator catalog
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       '200': { description: Dataset found }
   *       '404': { description: Dataset not found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dcat3/catalog/request:
   *   post:
   *     tags: [Data Catalog Discovery]
   *     summary: Hosted provider catalog request (tenant scoped)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: DSP catalog response }
   *       '404': { description: Tenant not found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dcat3/catalog/dcat.json:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Hosted provider catalog artifact (DCAT-3)
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *     responses:
   *       '200': { description: DCAT catalog artifact }
   *       '404': { description: Tenant not found }
   *
   * /{tenantId}/cds-{jurisdiction}/{version}/{sector}/dcat3/catalog/datasets/{id}:
   *   get:
   *     tags: [Data Catalog Discovery]
   *     summary: Read one provider dataset from hosted tenant catalog
   *     parameters:
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Version'
   *       - $ref: '#/components/parameters/Sector'
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       '200': { description: Dataset found }
   *       '404': { description: Not found }
   */
  // --- DSP DCAT-3 Catalog Endpoints (synchronous/public discovery) ---
  router.post('/dcat3/catalog/request', async (req, res) => {
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const allTenants = await tenantsCacheManager.listRegisteredTenants();
    const datasets = allTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d);

    const filtered = filterDatasets(datasets, req.body?.filters);
    const catalogBaseUrl = `${req.protocol}://${req.get('host')}/dcat3/catalog`;
    res.json(buildCatalog(catalogBaseUrl, `${req.protocol}://${req.get('host')}`, filtered));
  });

  router.get('/dcat3/catalog/dcat.json', async (req, res) => {
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const allTenants = await tenantsCacheManager.listRegisteredTenants();
    const datasets = allTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d);
    const catalogBaseUrl = `${req.protocol}://${req.get('host')}/dcat3/catalog`;
    res.json(buildCatalog(catalogBaseUrl, `${req.protocol}://${req.get('host')}`, datasets));
  });

  router.get('/dcat3/catalog/datasets/:id', async (req, res) => {
    const hostDid = await tenantsCacheManager.getDidDocument('host');
    if (!hostDid?.id) return res.status(503).type('text').send('Service Unavailable');

    const allTenants = await tenantsCacheManager.listRegisteredTenants();
    const datasets = allTenants
      .map(toProviderDataset)
      .filter((d): d is ProviderDataset => !!d);
    const dataset = datasets.find((d) => d.datasetId === req.params.id);
    if (!dataset) return res.status(404).type('text').send('Not Found');

    const catalogBaseUrl = `${req.protocol}://${req.get('host')}/dcat3/catalog`;
    const [single] = buildCatalog(catalogBaseUrl, `${req.protocol}://${req.get('host')}`, [dataset])['dcat:dataset'];
    res.json(single);
  });

  router.post('/:tenantId/cds-:jurisdiction/:version/:sector/dcat3/catalog/request', resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    if (!tenantConfig?.didDocument?.id) return res.status(404).type('text').send('Not Found');

    const dataset = toProviderDataset(tenantConfig);
    if (!dataset) return res.status(404).type('text').send('Not Found');
    const filtered = filterDatasets([dataset], req.body?.filters);

    const catalogBaseUrl = `${req.protocol}://${req.get('host')}/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/dcat3/catalog`;
    res.json(buildCatalog(catalogBaseUrl, `${req.protocol}://${req.get('host')}`, filtered));
  });

  router.get('/:tenantId/cds-:jurisdiction/:version/:sector/dcat3/catalog/dcat.json', resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    if (!tenantConfig?.didDocument?.id) return res.status(404).type('text').send('Not Found');

    const dataset = toProviderDataset(tenantConfig);
    if (!dataset) return res.status(404).type('text').send('Not Found');

    const catalogBaseUrl = `${req.protocol}://${req.get('host')}/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/dcat3/catalog`;
    res.json(buildCatalog(catalogBaseUrl, `${req.protocol}://${req.get('host')}`, [dataset]));
  });

  router.get('/:tenantId/cds-:jurisdiction/:version/:sector/dcat3/catalog/datasets/:id', resolveTenant, async (req, res) => {
    const tenantConfig = await tenantsCacheManager.getTenant(res.locals.vaultId);
    if (!tenantConfig?.didDocument?.id) return res.status(404).type('text').send('Not Found');

    const dataset = toProviderDataset(tenantConfig);
    if (!dataset || dataset.datasetId !== req.params.id) return res.status(404).type('text').send('Not Found');

    const catalogBaseUrl = `${req.protocol}://${req.get('host')}/${req.params.tenantId}/cds-${req.params.jurisdiction}/${req.params.version}/${req.params.sector}/dcat3/catalog`;
    const [single] = buildCatalog(catalogBaseUrl, `${req.protocol}://${req.get('host')}`, [dataset])['dcat:dataset'];
    res.json(single);
  });

  // --- FHIR-Specific Endpoints ---
  const checkFhirSector = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const sector = await tenantsCacheManager.getTenantSector(res.locals.vaultId);
    if (isFhirSector(sector)) {
      return next();
    }
    res.status(404).type('text').send('Not Found');
  };

  router.get([`${hostWellKnownPrefix}/smart-configuration`, `${tenantWellKnownPrefix}/smart-configuration`], resolveTenant, checkFhirSector, (req, res) => {
    const config = discoveryService.getSmartConfiguration(res.locals.vaultId);
    if (config) {
      res.json(config);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  
  // Note: The FHIR metadata endpoint uses the full structured path.
  router.get('/:tenantId/cds-:jurisdiction/:version/:sector/fhir/metadata', resolveTenant, checkFhirSector, (req, res) => {
    const statement = discoveryService.getCapabilityStatement(res.locals.vaultId);
    if (statement) {
      res.json(statement);
    } else {
      res.status(404).type('text').send('Not Found');
    }
  });
  return router;
}
