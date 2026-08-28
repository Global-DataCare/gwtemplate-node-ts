// src/routes/api.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IApiTenantRegistry } from '../managers/IApiTenantRegistry';
import { QueueAdapter } from '../adapters/queue';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';
import { createJobName } from '../utils/naming';
import { isRequestValid } from '../utils/request-validator';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { JWK } from 'gdc-common-utils-ts/models/jwk';
import { VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { getTenantVaultIdFromIss, getTenantVaultId } from '../utils/tenant';
import { composeHostDidWebId } from '../utils/did-backend';
import { buildGaiaXLegalParticipantOptionsFromClaims, createGaiaXLegalParticipantCredential } from '../utils/credential-generators';
import { AppAuthorizationManager } from '../managers/AppAuthorizationManager';
import { getEnvSectionId } from '../utils/section-env';
import { IReplayProtectionStore, ReplayProtectionStoreNoop } from '../adapters/replay-protection-store';
import { sendDidcommEarlyError } from '../utils/didcomm-error-response';
import {
  ACTION_DISABLE,
  ACTION_DISABLE_DESCENDANTS,
  ACTION_ENABLE,
  ACTION_PURGE,
  ACTION_PURGE_DESCENDANTS,
  ACTION_STATUS,
} from '../constants/domain';
import { getTenantAuthorizationStatus as readTenantAuthorizationStatusFromConfig } from '../utils/tenant-lifecycle';
import { enforceSmartScopeRouteCompatibility } from '../utils/smart-scope-route-authorization';
import { IdentityAuthActions } from 'gdc-common-utils-ts/constants/identity-auth';

const FORWARDED_HEADER_SEPARATOR = ',';
type SecurityMode = 'strict' | 'compat' | 'demo';
type ParsedContentType = 'secure-form' | 'didcomm-plain' | 'json' | 'fhir' | 'unsupported';
const DIDCOMM_PLAINTEXT_JSON_LEGACY_MEDIA_TYPE = 'application/didcomm-plaintext+json';

function getVerifiedBearerPayload(verificationResult: any): Record<string, any> {
  if (!verificationResult || typeof verificationResult !== 'object') return {};
  const payload = (verificationResult as any).payload;
  if (payload && typeof payload === 'object') {
    return payload as Record<string, any>;
  }
  const clone = { ...(verificationResult as Record<string, any>) };
  delete (clone as any).valid;
  delete (clone as any).error;
  return clone;
}

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'disabled') return false;
  return fallback;
}

function resolveSecurityModeFromEnv(): SecurityMode {
  const normalized = String(process.env.SECURITY_MODE || 'strict').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'compat' || normalized === 'demo') return normalized;
  return 'strict';
}

function normalizeContentType(rawValue: string | undefined): string {
  if (!rawValue) return '';
  return String(rawValue).split(';')[0].trim().toLowerCase();
}

function acceptLegacyDidcommPlaintextMediaType(): boolean {
  return parseBooleanEnv(process.env.DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE, false);
}

function parseIncomingContentType(contentType: string): ParsedContentType {
  if (contentType === 'application/x-www-form-urlencoded') return 'secure-form';
  if (contentType === 'application/didcomm-plain+json') return 'didcomm-plain';
  if (acceptLegacyDidcommPlaintextMediaType() && contentType === DIDCOMM_PLAINTEXT_JSON_LEGACY_MEDIA_TYPE) return 'didcomm-plain';
  if (contentType === 'application/json') return 'json';
  if (contentType === 'application/fhir+json') return 'fhir';
  return 'unsupported';
}

function normalizeDidcommBodyForFhirFormat<T extends { body?: any } | undefined>(
  content: T,
  format: string | undefined,
): T {
  if (!content) return content;
  const normalizedFormat = String(format || '').toLowerCase();
  if (!normalizedFormat.includes('fhir')) return content;

  const body = (content as any).body;
  if (!body || typeof body !== 'object') return content;
  if (Array.isArray(body.data)) return content;
  if (!Array.isArray(body.entry)) return content;

  return {
    ...(content as any),
    body: {
      ...body,
      data: body.entry,
    },
  } as T;
}

/**
 * Normalizes legacy plaintext request bodies so managers can consume them
 * through the same `job.content.body` contract used by secure DIDComm flows.
 *
 * Why this exists:
 * - secure requests arrive as a DIDComm envelope whose business payload already
 *   lives under `content.body`
 * - legacy `application/json` and `application/fhir+json` requests often send
 *   the business payload directly at the top level
 * - most managers only read `job.content.body`
 *
 * The returned object keeps top-level fields such as `thid`, while also
 * mirroring the normalized business payload under `body`.
 */
function normalizeLegacyPlaintextContent<T extends Record<string, any>>(content: T): T & { body: any } {
  if (content && typeof content === 'object' && content.body && typeof content.body === 'object') {
    return content as T & { body: any };
  }

  return {
    ...(content || {}),
    body: content || {},
  };
}

/**
 * Reads the optional public verification key carried by a legacy plaintext
 * DIDComm envelope. Post-DCR encrypted requests resolve their registered key
 * from `iss` and `kid`; this projection is only a compat-mode bridge and never
 * replaces a key registered by DCR.
 */
function projectedControllerProofJwk(body: unknown): JWK | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const candidate = (body as any)?.meta?.jws?.protected?.jwk;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as JWK
    : undefined;
}

function isContentTypeAllowedBySecurityPolicy(contentType: ParsedContentType): boolean {
  const securityMode = resolveSecurityModeFromEnv();
  if (contentType === 'secure-form') return true;
  if (contentType === 'unsupported') return false;

  if (securityMode === 'strict') return false;
  if (securityMode === 'demo') return true;

  const didcommPlainEnabled = parseBooleanEnv(process.env.DIDCOMM_PLAIN, false);
  const fhirLegacy = parseBooleanEnv(process.env.FHIR_LEGACY, false);
  const jsonLegacy = parseBooleanEnv(process.env.JSON_LEGACY, false);

  if (contentType === 'didcomm-plain') return didcommPlainEnabled;
  if (contentType === 'fhir') return fhirLegacy;
  if (contentType === 'json') return jsonLegacy;
  return false;
}

function allowsInsecureBearerBySecurityMode(): boolean {
  return resolveSecurityModeFromEnv() === 'demo'
    && parseBooleanEnv(process.env.DEMO_ALLOW_INSECURE_BEARER, false);
}

function isHostOrganizationActivateRoute(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  return tenantId === 'host'
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'organization'
    && action === '_activate';
}

function isHostTenantLifecycleRoute(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  return tenantId === 'host'
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'organization'
    && (
      action === ACTION_DISABLE
      || action === ACTION_ENABLE
      || action === ACTION_PURGE
      || action === ACTION_STATUS
      || action === ACTION_DISABLE_DESCENDANTS
      || action === ACTION_PURGE_DESCENDANTS
    );
}

/**
 * Host commercial Orders continue a tenant-authored Offer through the shared
 * registry endpoint. They are host-routed jobs, but their post-DCR sender proof
 * still belongs to the tenant controller identified by the signed `iss`.
 */
function isHostControllerCommercialOrderRoute(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  return tenantId === 'host'
    && section === 'registry'
    && String(format || '').toLowerCase() === 'org.schema'
    && String(resourceType || '').toLowerCase() === 'order'
    && action === '_batch';
}

function requiresActiveTenantAuthorization(
  tenantId: string,
  section: string,
  format: string,
  resourceType: string,
  action: string,
): boolean {
  if (tenantId === 'host') {
    return false;
  }
  if (section === 'ping') {
    return false;
  }
  if (isHostOrganizationActivateRoute(tenantId, section, format, resourceType, action)) {
    return false;
  }
  if (isHostTenantLifecycleRoute(tenantId, section, format, resourceType, action)) {
    return false;
  }
  return true;
}

function getRequestBaseUrl(req: express.Request, fallback: string): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const forwardedProtocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)
    ?.split(FORWARDED_HEADER_SEPARATOR)[0]
    ?.trim();
  const socketEncrypted = (req.socket as { encrypted?: boolean } | undefined)?.encrypted;
  const protocol = forwardedProtocol || (socketEncrypted ? 'https' : 'http');
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) || req.get('host');
  return host ? `${protocol}://${host}` : fallback;
}

type RouteParams = {
  tenantId: string;
  jurisdiction: string;
  sector: string;
  section: string;
  format: string;
  resourceType: string;
  action?: string;
  actionResponse?: string;
};

/**
 * @openapi
 * /{tenantId}/cds-{jurisdiction}/v1/{sector}/{section}/org.hl7.fhir.r5/SubscriptionTopic/_batch:
 *   post:
 *     summary: Register FHIR R5 subscription topics
 *     description: >-
 *       Registers the neutral topic catalog used by GW CORE. The section is
 *       normally entity. Topics are stored encrypted and later used to
 *       validate Subscription filters.
 *     tags: [FHIR R5 Subscriptions]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *       - { in: path, name: jurisdiction, required: true, schema: { type: string } }
 *       - { in: path, name: sector, required: true, schema: { type: string } }
 *       - { in: path, name: section, required: true, schema: { type: string, enum: [entity] } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/fhir+json:
 *           schema: { type: object }
 *     responses:
 *       '202': { description: Accepted for asynchronous processing }
 *       '400': { description: Invalid SubscriptionTopic or route }
 *       '415': { description: Media type rejected by the active security profile }
 */

/**
 * @openapi
 * /{tenantId}/cds-{jurisdiction}/v1/{sector}/{section}/org.hl7.fhir.r5/Subscription/_batch:
 *   post:
 *     summary: Register FHIR R5 rest-hook subscriptions
 *     description: >-
 *       Registers an encrypted tenant or exact-subject Subscription. GW CORE
 *       validates the filters against an active SubscriptionTopic, performs
 *       the standard rest-hook handshake, and activates delivery only after a
 *       successful response. Individual scope requires an exact patient or
 *       subject filter.
 *     tags: [FHIR R5 Subscriptions]
 *     parameters:
 *       - { in: path, name: tenantId, required: true, schema: { type: string } }
 *       - { in: path, name: jurisdiction, required: true, schema: { type: string } }
 *       - { in: path, name: sector, required: true, schema: { type: string } }
 *       - { in: path, name: section, required: true, schema: { type: string, enum: [entity, individual] } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/fhir+json:
 *           schema: { type: object }
 *     responses:
 *       '202': { description: Accepted for asynchronous processing }
 *       '400': { description: Invalid Subscription, filter, topic, or endpoint }
 *       '404': { description: Tenant vault or active topic not found }
 *       '415': { description: Media type rejected by the active security profile }
 */

/**
 * Backward/forward compatibility adapter:
 * - Canonical SDK identity pattern (preferred for new integrations):
 *   /host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/{action}
 * - Legacy runtime-compatible pattern (temporary alias during migration):
 *   /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/{openid|firebase}/{Token|Device|License}/{action}
 */
function normalizeUnifiedIdentityAuthRouteParams(raw: RouteParams): RouteParams {
  const format = String(raw.format || '').toLowerCase();
  const resourceType = String(raw.resourceType || '').toLowerCase();
  if (format !== 'identity' || resourceType !== 'auth') {
    return raw;
  }

  const actionRaw = String(raw.action || raw.actionResponse || '');
  const actionBase = actionRaw.endsWith('-response')
    ? actionRaw.slice(0, -('-response'.length))
    : actionRaw;
  const mappedTenantId = String(raw.section || '').trim();
  if (!mappedTenantId) return raw;

  let mappedFormat: string | undefined;
  let mappedResourceType: string | undefined;

  if (actionBase === IdentityAuthActions.Dcr
    || actionBase === IdentityAuthActions.Revoke
    || actionBase === IdentityAuthActions.Search) {
    mappedFormat = 'openid';
    mappedResourceType = 'Device';
  } else if (actionBase === '_code' || actionBase === '_token' || actionBase === '_exchange' || actionBase === '_recover') {
    mappedFormat = 'openid';
    mappedResourceType = 'Token';
  } else if (actionBase === IdentityAuthActions.Issue) {
    mappedFormat = 'openid';
    mappedResourceType = 'License';
  } else if (actionBase === '_custom') {
    mappedFormat = 'firebase';
    mappedResourceType = 'Token';
  }

  if (!mappedFormat || !mappedResourceType) {
    return raw;
  }

  return {
    ...raw,
    tenantId: mappedTenantId,
    section: 'identity',
    format: mappedFormat,
    resourceType: mappedResourceType,
  };
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
  tenantsCacheManager: IApiTenantRegistry,
  kmsService: IKmsService,
  asyncResponseStore: IAsyncResponseStore,
  vaultRepository: IVaultRepository,
  cryptographyService: ICryptography,
  apiBaseUrl: string,
  appAuthManager?: AppAuthorizationManager,
  replayProtectionStore: IReplayProtectionStore = new ReplayProtectionStoreNoop(),
): express.Router {
  const router = express.Router();

  const resolveVaultId = async (tenantId: string, sector: string): Promise<string> => {
    if (tenantId === 'host') return 'host';
    const directVaultId = getTenantVaultId(sector, tenantId);
    if (await tenantsCacheManager.tenantExists(directVaultId)) return directVaultId;

    const canonicalVaultId = await tenantsCacheManager.findTenantVaultIdByIdentifierValue(tenantId);
    if (canonicalVaultId) return canonicalVaultId;
    return directVaultId;
  };

  /**
   * Resolves the storage scope used to bind controller proof `iss + kid` to
   * the signing key registered by DCR. The rule is transport- and
   * sector-agnostic; host bootstrap remains outside post-DCR tenant scope.
   */
  const controllerProofRegistrationContext = async (tenantId: string, sector: string) => {
    if (tenantId === 'host') return undefined;
    const vaultId = await resolveVaultId(tenantId, sector);
    const collectionName = await tenantsCacheManager.getCollectionName(vaultId);
    return { vaultId, ...(collectionName ? { collectionName } : {}) };
  };

  /**
   * Separates job routing from controller-key custody. Most requests use the
   * path tenant for both. A host `Order/_batch` remains queued in `host`, while
   * its encrypted sender keys are resolved from the tenant encoded in the
   * already-signed controller DID. An unknown or legacy DID falls back to the
   * host scope and therefore fails closed unless that key is actually hosted.
   */
  const resolveRegisteredSenderVaultId = async (
    tenantId: string,
    sector: string,
    section: string,
    format: string,
    resourceType: string,
    action: string,
    senderDid: string,
  ): Promise<string> => {
    const pathVaultId = await resolveVaultId(tenantId, sector);
    if (!isHostControllerCommercialOrderRoute(tenantId, section, format, resourceType, action)) {
      return pathVaultId;
    }
    try {
      const issuerVaultId = getTenantVaultIdFromIss(senderDid);
      return await tenantsCacheManager.tenantExists(issuerVaultId) ? issuerVaultId : pathVaultId;
    } catch {
      return pathVaultId;
    }
  };

  const getReplayTtlSeconds = (payload: any): number => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = Number(payload?.exp);
    if (Number.isFinite(exp)) {
      const delta = Math.floor(exp - nowSeconds);
      // Keep bounded TTL to avoid pathological cache growth.
      return Math.max(60, Math.min(86400, delta));
    }
    return 900;
  };

  const cdsRoutePrefix = '/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType';

  // --- ASYNC JOB POLLING ENDPOINT (MUST BE DEFINED BEFORE THE GENERIC SUBMISSION ENDPOINT) ---

  const pollingHandler = async (req: express.Request, res: express.Response) => {
    let thid = String(req.method === 'POST' ? req.body?.thid || '' : req.query.thid || '').trim();

    // Secure submit and poll requests use the same form-encoded JWE contract.
    // The SDK therefore protects `{ thid }` inside `request=<JWE>` instead of
    // leaking the correlation identifier as an extra plaintext form field.
    if (!thid && req.method === 'POST' && parseIncomingContentType(normalizeContentType(req.headers['content-type'])) === 'secure-form') {
      const compactJwe = String(req.body?.request || '').trim();
      if (compactJwe) {
        try {
          const decodedPoll = await kmsService.decodeRequest(compactJwe);
          thid = String(decodedPoll.content?.thid || '').trim();
        } catch (error: any) {
          return sendDidcommEarlyError(
            req,
            res,
            400,
            IssueType.Security,
            `Failed to process secure polling request: ${error?.message || 'JWE decoding failed.'}`,
          );
        }
      }
    }

    if (!thid) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        'Missing or invalid "thid" parameter.',
      );
    }

    const job = asyncResponseStore.get(thid);
    if (!job) {
      return sendDidcommEarlyError(req, res, 404, IssueType.NotFound);
    }
    // TODO(contract-unification): polling status model here is `PENDING|COMPLETED|FAILED`.
    // Preconversion API currently exposes `queued|running|succeeded|failed` for upload polls.
    // Define one canonical async public status vocabulary across services.
    if (job.status === 'PENDING') {
      res.set('Retry-After', '5');
      return res.status(202).json({ thid, status: 'PENDING' });
    }

    if (job.status === 'COMPLETED' && job.result) {
      try {
        // --- ARCHITECTURE KEEPER: UNIFIED RESPONSE HANDLING ---
        // The Worker guarantees that `job.result` is ALWAYS a JWE string (or a stringified
        // JSON error). This handler's responsibility is to correctly unpack it based on
        // the original request flow. This consistency prevents architectural drift.
        
        // In the rare case of a plaintext error from the worker, we attempt to parse it.
        // If it's not JSON, we treat it as a raw JWE string.
        let resultIsJson = false;
        try {
          JSON.parse(job.result);
          resultIsJson = true;
        } catch(e) { /* ignore, it's a JWE string */ }
        
        if (job.contentType?.includes('json') || resultIsJson) {
          // --- FLOW A: LEGACY / PLAINTEXT ---
          // The client expects a JSON response. We must decode the JWE to extract the payload.
          // This also handles plaintext error objects returned by the worker.
          if (resultIsJson) {
            // A stringified JSON result from the worker indicates an error during processing.
            res.set('Content-Type', 'application/json');
            res.status(500).json(JSON.parse(job.result));
          } else {
            // The result is a JWE. Decrypt it to get the plaintext payload.
            const decodedResponse = await kmsService.decodeRequest(job.result);
            if (!decodedResponse.content?.body) {
              throw new Error('Decoded response from worker is missing expected content body.');
            }
            // For legacy flows, respond with the decrypted content body using the original request's content type.
            res.set('Content-Type', job.contentType || 'application/json');
            res.status(200).json(decodedResponse.content.body);
          }
        } else {
          // --- FLOW B: FAPI / SECURE ---
          // The client expects the encrypted JWE response directly.
          res.set('Content-Type', 'application/x-www-form-urlencoded');
          res.status(200).send(`response=${job.result}`);
        }
        asyncResponseStore.delete(thid);
      } catch (error: any) {
        console.log('[Polling Handler] Error caught:', error); // Using console.log for visibility in Jest
        return sendDidcommEarlyError(
          req,
          res,
          500,
          IssueType.Exception,
          'Failed to decode the stored job result: ' + error.message,
        );
      }
    } else {
      return sendDidcommEarlyError(
        req,
        res,
        500,
        IssueType.Exception,
        'Job failed to process or result was invalid.',
      );
    }
  };

  const isFhirSector = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // This middleware logic is still broken as it relies on properties not exposed by the cache.
    // For now, bypassing to allow tests to proceed. A new lookup method in the cache is needed.
    // e.g., getTenantSector(vaultId)
    // TODO: Refactor this to use a new specific cache function.
    return next();
  };

  // Canonical polling pattern: the Location URL is always the original request URL + `-response`.
  // Examples:
  // - `.../Organization/_batch` -> `.../Organization/_batch-response`
  // - `.../identity/openid/Device/_dcr` -> `.../identity/openid/Device/_dcr-response`
  // - `.../identity/openid/smart/token` -> `.../identity/openid/smart/token-response`
  const pollingRoute = `${cdsRoutePrefix}/:actionResponse`;
  const pollingGate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const actionResponse = String(req.params.actionResponse || '');
    if (!actionResponse.endsWith('-response')) return next();
    return pollingHandler(req, res);
  };
  const didDocumentBindingRoute = '/:tenantId/cds-:jurisdiction/v1/:sector/did/document/:action';
  const didDocumentBindingPollingRoute = '/:tenantId/cds-:jurisdiction/v1/:sector/did/document/:actionResponse';
  const didDocumentBindingPollingGate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const actionResponse = String(req.params.actionResponse || '');
    if (!actionResponse.endsWith('-response')) return next();
    req.params = {
      ...req.params,
      section: 'did',
      format: 'document',
      resourceType: 'Document',
    };
    return pollingHandler(req, res);
  };
  router.post(didDocumentBindingPollingRoute, didDocumentBindingPollingGate);
  router.get(didDocumentBindingPollingRoute, isFhirSector, didDocumentBindingPollingGate);
  router.post(pollingRoute, pollingGate);
  router.get(pollingRoute, isFhirSector, pollingGate);

  // Backward-compat alias: older versions used a fixed `_batch-response` action.
  router.post(`${cdsRoutePrefix}/_batch-response`, pollingHandler);
  router.get(`${cdsRoutePrefix}/_batch-response`, isFhirSector, pollingHandler);

  /**
   * @openapi
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/oidc/credential:
   *   post:
   *     tags:
   *       - 2.2 OIDC4VCI
   *     summary: Issue a Gaia-X compliance VC (OIDC4VCI)
   *     description: |
   *       Issues a Gaia-X Legal Participant VC. This endpoint expects a Bearer access_token.
   *       In demo/non-production, any Bearer token is accepted for now.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               format: { type: string }
   *               type: { type: string }
   *               pqc: { type: boolean }
   *     responses:
   *       '200': { description: Issued VC }
   *       '401': { description: Missing or invalid Bearer token }
   *       '404': { description: Tenant not found }
   */
  router.post('/:tenantId/cds-:jurisdiction/v1/:sector/identity/oidc/credential', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
    }
    const accessToken = authHeader.split(' ')[1];
    if (!allowsInsecureBearerBySecurityMode()) {
      if (!appAuthManager) {
        return sendDidcommEarlyError(
          req,
          res,
          500,
          IssueType.Exception,
          'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
        );
      }
      try {
        await appAuthManager.verifyBearerToken(accessToken);
      } catch (error: any) {
        return sendDidcommEarlyError(
          req,
          res,
          401,
          IssueType.Security,
          `Invalid Bearer token: ${error?.message || 'verification failed'}`,
        );
      }
    }

    const { tenantId, sector } = req.params;
    const vaultId = await resolveVaultId(tenantId, sector);
    const tenantConfig = await tenantsCacheManager.getTenant(vaultId);
    if (!tenantConfig?.claims || !tenantConfig?.didDocument) {
      return res.status(404).type('text').send('Not Found');
    }

    const hostConfig = await tenantsCacheManager.getTenant('host');
    const issuerVaultId = 'host';
    const issuerDid = hostConfig?.didDocument?.id || composeHostDidWebId(apiBaseUrl, process.env.HOST_EXTERNAL_DOMAIN);
    const subjectDid = tenantConfig.didDocument.id;
    const tenantUrl = await tenantsCacheManager.getTenantDomainUrl(vaultId);
    if (!tenantUrl) {
      return res.status(404).type('text').send('Not Found');
    }

    const forcePqc = String(req.query.pqc || req.headers['x-pqc-signature'] || '').toLowerCase() === 'true';
    const legacyAlgCandidate = hostConfig?.legacySignAlg || process.env.LEGACY_SIGN_ALG;
    const preferredAlg = (!forcePqc && legacyAlgCandidate) ? legacyAlgCandidate : 'ML-DSA-44';
    const signingKey = await kmsService.getPublicVerificationKey(issuerVaultId, preferredAlg, 'vc_sign');
    if (!signingKey?.kid) {
      throw new Error('Signing key not available for credential issuance.');
    }

    const credentialOptions = buildGaiaXLegalParticipantOptionsFromClaims({
      claims: tenantConfig.claims,
      webDomain: tenantUrl,
      did: subjectDid,
      issuerDid: issuerDid,
    });
    const unsignedVc = createGaiaXLegalParticipantCredential(credentialOptions);
    const detachedJws = await kmsService.createDetachedJws(unsignedVc, signingKey.kid, issuerVaultId, 'vc_sign');

    const signedVc = {
      ...unsignedVc,
      proof: [{
        type: 'JsonWebSignature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${issuerDid}#${signingKey.kid}`,
        jws: detachedJws,
      }],
    };

    res.json(signedVc);
  });

  /**
   * @openapi
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Register a new Tenant (Organization)
   *     description: |
   *       Submits an asynchronous job to register a new tenant on the platform. This is the first step for any new organization.
   *       The endpoint supports both a plaintext JSON "legacy" flow (for simple onboarding) and a JWE-based "secure" flow.
   *
   *       The `{sector}` segment is a host onboarding "network environment" selector:
   *       - demo/test: `test`
   *       - development/staging: `test-network`
   *       - production: `network`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         The DIDComm message for registration.
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/OrganizationRegistrationLegacy'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationRegistrationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/OrganizationRegistrationLegacy'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The job has been queued. The client should poll the URL provided in the `Location` header to get the result.
   *         headers:
   *           Location:
   *             schema:
   *               type: string
   *             description: The polling URL for the job result.
   *           Retry-After:
   *             schema:
   *               type: string
   *               example: '5'
   *             description: Suggested delay in seconds before polling.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or sector).
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate:
   *   post:
   *     tags:
   *       - 1.1 Organization Activation
   *     summary: Activate a new Tenant (Organization) from ICA-issued proof
   *     description: |
   *       Submits an asynchronous job to activate a new tenant on the platform from
   *       ICA-issued proof. This is a distinct flow from the legacy `_batch`
   *       registration endpoint.
   *
   *       The `{sector}` segment is a host onboarding network selector:
   *       - demo/test: `test`
   *       - development/staging: `test-network`
   *       - production: `network`
   *
   *       Expected semantics:
   *       - canonical proof input is `body.vp_token`; it contains the ICA-issued OrganizationCredential, LegalRepresentativeCredential and ServiceControllerCredential
   *       - LegalRepresentativeCredential carries legal capacity and professional ISCO occupation; it does not grant tenant control by itself
   *       - ServiceControllerCredential carries `RESPRSN` in `owner.additionalType`, ISCO in `owner.hasOccupation.occupationalCategory`, and `owner.hasCredential.material` bound to the presenter actor JWK
   *       - legacy two-VC compatibility normally requires the old LegalRepresentativeCredential itself to contain both `RESPRSN` and matching `hasCredential` material
   *       - a deployment-wide compatibility policy may accept historical representative credentials that predate those two fields, while normal VP, credential and trust checks remain mandatory
   *       - that historical credential may retain professional occupation `ISCO-08|1120`; the bootstrap policy does not rewrite it as `RESPRSN`
   *       - that narrow exception applies only while creating or re-registering the historical first controller; `_issue` and ordinary employee lifecycle never consult it
   *       - submitting the same exact legacy binding again for an existing tenant performs an idempotent controller upsert and recreates the tenant collection when it is missing
   *       - if ICA also issued a `SoftwareApplication` VC for the portal/backend, its `SoftwareApplication.material` field is the public cryptographic material of that software application, typically the communication signing key id bound during ICA registration
   *       - when that key id is represented as a JWK thumbprint, RFC 7638 defines the canonical thumbprint calculation over the public signing / verification JWK and RFC 9278 defines the canonical URN form `urn:ietf:params:oauth:jwk-thumbprint:sha-256:<base64url>`
   *       - the controller-side signature belongs to the prior ICA registration step; later operational app-service proofs should be signed by the app-service key itself
   *       - `org.schema.Service.url` is the hosting URL selected by the controller during onboarding; it identifies the chosen hosting operator / connector location and is separate from the tenant public `did:web`
   *       - `org.schema.Service.serviceType` is already required at this step because GW uses it to validate the requested tenant capabilities and prepare the pending Offer that will later be confirmed in `Order/_batch`
   *       - `body.controller.*` is the explicit controller key-binding contract inherited from the ICA model and is used when GW must publish/bootstrap the controller person DID
   *       - `body.organizationCredential` / `body.representativeCredential` are deprecated compatibility fields and must not be treated as the canonical proof contract
   *       - the host validates the ICA proof, creates the bootstrap controller employee and references its DID from the tenant DID in the first active version
   *       - activation response includes Offer claims derived from `org.schema.Organization.numberOfEmployees`
   *         (include that claim in `meta.claims` to size requested seats)
   *         so clients can continue with order/payment and licensing without a separate `_batch` submit
   *       - next mandatory step is `Order/_batch` with `Order.acceptedOffer.identifier` from activation result
   *       - after Order, the controller uses activation code (`org.schema.IndividualProduct.serialNumber`)
   *         to run `Token/_exchange` + `Device/_dcr` before creating additional employees
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted
   *         (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationActivationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The activation job has been queued. The client should poll
   *           the URL provided in the `Location` header to get the result.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or network selector).
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Reverify an existing legal organization and reissue one controller activation code
   *     description: |
   *       Existing-tenant recovery/reactivation route.
   *
   *       Responsibilities of this issue flow:
   *       - carry the signed terms PDF evidence or PDF URL attachment again
   *       - carry the current controller business binding key in `body.data[].resource.controller.publicKeyJwk`
   *       - forward the legal evidence to ICA `_verify`
   *       - return the refreshed OrganizationCredential, LegalRepresentativeCredential and ServiceControllerCredential in `vc[]` without creating a new commercial Offer
   *       - use ServiceControllerCredential to append or refresh the technical controller employee and tenant DID controller reference
   *       - reserve/reissue one new activation code for that controller so the frontend can continue with `Token/_exchange` + `Device/_dcr`
   *       - leave portal-owned organization and representative database projections to the consuming BFF; GW does not mutate an external portal database
   *       - never infer controller authority from a LegalRepresentativeCredential carrying only ISCO-08|1120
   *
   *       Commercial rule:
   *       - this route must not overwrite the already contracted seat count
   *       - this route must not create a new Offer or require `Order/_batch`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted
   *         (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationIssuePlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The reissue job has been queued. The client should poll
   *           the URL provided in the `Location` header to get the result.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or network selector).
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the existing-tenant reissue result
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_issue`.
   *
   *       Polling semantics:
   *       - submit (`_issue`) returns immediate errors if the request cannot be accepted/enqueued
   *       - poll (`_issue-response`) returns `202` while pending, then `200` with:
   *         - `resource.meta.claims`: refreshed organization/controller claims plus the License activation code in `org.schema.IndividualProduct.serialNumber` for `Token/_exchange` + `Device/_dcr`
   *         - `vc[]`: all deduplicated credential resources extracted from ICA
   *         - `resource.icaResponse`: transitional raw upstream ICA envelope retained for audit/debug; clients should consume `vc[]` instead of parsing it
   *
   *       Response-boundary rule:
   *       - claims are canonical only at `data[].resource.meta.claims`; new writers do not emit `data[].meta.claims`
   *       - consumers upsert the three `vc[]` types independently; the legal representative is not a controller unless a separate valid ServiceControllerCredential says so
   *       - this is an organization-credential reissuance/reverification result, not a `License/_issue` result
   *       - the activation code is not a VC and `License:Issued` is not the canonical response entry type
   *       - `OperationOutcome.issue[]` remains the unrelated diagnostics array
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *       - $ref: '#/components/parameters/Thid'
   *     requestBody:
   *       description: |
   *         Plain JSON polling sends `{ "thid": "..." }`. Secure polling
   *         protects that same object inside form field `request=<JWE>`; it
   *         does not expose `thid` as a second plaintext form field.
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AsyncPollRequest'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/AsyncPollRequest'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *             examples:
   *               message: { $ref: '#/components/examples/OrganizationIssueResponseBundle' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Submit the first legal-organization onboarding transaction to ICA or Test Network review
   *     description: |
   *       Canonical first host-side onboarding step for a legal organization.
   *
   *       Responsibilities of this transaction:
   *       - carry the signed terms PDF evidence or PDF URL attachment
   *       - carry flattened application claims in `body.data[].resource.meta.claims`; entry-level `meta.claims` is accepted only as legacy input
   *       - carry the controller business binding key in `body.data[].resource.controller.publicKeyJwk`
   *       - optionally carry the organization VC-signing public key in `body.data[].resource.organization.publicKeyJwk`
   *       - carry the legal organization claims and representative payload that GW CORE forwards to ICA `_verify`
   *       - return three ICA credentials when controller identity and JWK evidence are complete: OrganizationCredential, LegalRepresentativeCredential and ServiceControllerCredential
   *       - on Test Network only, accept `OrganizationTestNetworkCredential` plus exactly those three domain credentials marked `TestNetworkCredential`, verify the reviewer's ML-DSA-65 proofs and return the three domain credentials in `vc[]` without calling ICA
   *       - carry that admission VC only in `body.data[].resource.organizationTestNetworkCredential` and the three domain VCs in `body.data[].resource.testNetworkCredentials`; no authorization-named alias is accepted
   *
   *       Separation of concerns:
   *       - `meta.jws` / `meta.jwe` remain communication/runtime keys of the portal app, confidential app, device profile, or BFF
   *       - `body.data[].resource.controller.publicKeyJwk` is the controller business/operation-signing key that ICA projects into `ServiceControllerCredential.owner.hasCredential.material`
   *       - `body.data[].resource.controller.email` is the technical controller; it is not inferred from the separate legal representative payload
   *       - LegalRepresentativeCredential defaults to `hasOccupation.occupationalCategory = ISCO-08|1120`; ServiceControllerCredential uses `owner.additionalType = RESPRSN` plus controller occupation `ISCO-08|1330` unless the signed PDF provides an explicit occupation
   *       - `body.data[].resource.organization.publicKeyJwk` is the organization credential-signing key when the hosting operator/runtime already knows it
   *       - this route is distinct from `Organization/_activate`, which starts from an already-issued ICA proof (`vp_token`)
   *       - this route persists the pending representative and verified request registration keys; the following `Order/_batch` builds that historical first controller before activating the tenant
   *       - for an existing tenant, the same deployment-authorized legacy binding re-registers that representative controller idempotently, returns no new Offer and does not require another Order
   *       - a later independent `_issue` appends the service controller from its `ServiceControllerCredential`; it does not replace the bootstrap controller
   *
   *       BFF/confidential-app note:
   *       - a BFF or confidential app may protect the DIDComm/FAPI envelope with its own communication key
   *       - that communication key must not replace the controller business binding key sent in the business payload
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted
   *         (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationVerificationTransactionPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: |
   *           Accepted. The verification-forwarding job has been queued. The client should poll
   *           the URL provided in the `Location` header to get the result.
   *       '400':
   *         description: Bad Request. The payload is malformed.
   *       '401':
   *         description: Unauthorized. Invalid or missing Bearer token for legacy flow, or failed JWE decryption/JWS verification for secure flow.
   *       '404':
   *         description: Not Found. The requested endpoint path does not exist (e.g., invalid jurisdiction or network selector).
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the legal-organization verification transaction result
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_transaction`.
   *
   *       Polling semantics:
   *       - submit (`_transaction`) returns immediate errors if the request cannot be accepted/enqueued
   *       - poll (`_transaction-response`) returns `202` while pending, then `200` with:
   *         - `resource.meta.claims`: canonical host claims; first-time onboarding includes the Offer identifier
   *         - `resource.icaResponse`: transitional raw ICA envelope retained for audit/debug; application clients should read `vc[]`
   *         - `vc[]`: extracted credential resources from that ICA payload
   *         - first-time `resource.next`: the explicit follow-up contract for `Order/_batch`
   *         - exact existing-tenant legacy re-registration omits Offer and `resource.next` after idempotently upserting the representative controller
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *       - $ref: '#/components/parameters/Thid'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/AsyncPollRequest'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/AsyncPollRequest'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/AsyncPollRequest'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/AsyncPollRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *             examples:
   *               message:
   *                 $ref: '#/components/examples/OrganizationVerificationTransactionResponseBundle'
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Create a new Professional (Employee)
   *     description: |
   *       Submits an asynchronous job to create or enable again a professional (employee) within an existing tenant.
   *       The `tenantId` in the path specifies the organization under which the employee is being created.
   *       Prerequisite: controller device/client must already be active (`Token/_exchange` + `Device/_dcr`).
   *       Creating an employee profile does not automatically activate employee devices.
   *       Additional employees require `License/_issue`. A second device for the
   *       same employee reuses that seat and activation code, sending a distinct
   *       `client_instance_id` through `_exchange` and `_dcr` (default allowance: 2).
   *       
   *       V1 lifecycle semantics:
   *       - business identity is the combination `email + role`
   *       - if the same `email + role` already exists and is active, the gateway returns the existing employee instead of creating a duplicate
   *       - if the same `email + role` exists and is inactive, the gateway enables that employee record again
   *       - employee suspension does not implicitly release the reserved license seat
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         DIDComm request for employee creation.
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/EmployeeCreationLegacy'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/EmployeeRegistrationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/EmployeeCreationLegacy'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted. The job has been queued.
   *         headers:
   *           Location:
   *             schema: { type: string }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch-response:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Poll the employee creation job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/EmployeePollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/EmployeePollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_search:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Search employees within an existing tenant
   *     description: |
   *       Submits an asynchronous employee directory query.
   *       Supported request shapes:
   *       - legacy Bundle search entry:
   *         - `body.resourceType = Bundle`
   *         - `body.entry[0].request.method = GET`
   *         - `body.entry[0].request.url = Employee?...`
   *       - preferred Bundle search entry:
   *         - `body.resourceType = Bundle`
   *         - `body.entry[0].request.method = POST`
   *         - `body.entry[0].request.url = Employee/_search`
   *         - `body.entry[0].resource.resourceType = Parameters`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/LegacyMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/LegacyMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted. The search job has been queued.
   *         headers:
   *           Location:
   *             schema: { type: string }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_search-response:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Poll the employee search job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom:
   *   post:
   *     tags:
   *       - 2.1.1 Frontend Identity Federation (Optional)
   *     summary: Federate external OIDC id_token to Firebase custom token (async)
   *     description: |
   *       Submits an async job that verifies a provider id_token (e.g. eIDAS) and returns a Firebase custom_token.
   *
   *       This endpoint is always DIDComm (plaintext in demo, encrypted in production).
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         With `@context: "org.schema"`, clients may send contextualized keys such as `Organization.identifier.value`
   *         or `Service.category` without the `org.schema.` prefix; that is the documented default mode.
   *         If the service enables `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, equivalent fully-qualified `org.schema.*`
   *         keys remain valid. `Service.termsOfService` may be an HTTPS URL or an embedded PDF data URL; Swagger uses
   *         the HTTPS URL form as the default example.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/FirebaseCustomTokenPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *       '400': { description: Bad Request. }
   *       '401': { description: Unauthorized. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom-response:
   *   post:
   *     tags:
   *       - 2.1.1 Frontend Identity Federation (Optional)
   *     summary: Poll the federation result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/ConsentPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/ConsentPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/InitialAccessTokenExchangeResponse' }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange:
   *   post:
   *     tags:
   *       - 2.1.2 Initial Access Token Exchange
   *     summary: Exchange activation code for initial_access_token (async)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_exchange`.
   *       This `identity/openid` route is maintained as a temporary compatibility alias.
   *
   *       Submits an async job that exchanges:
   *       - Authorization Bearer token: Firebase `id_token` (JWT format), and
   *       - request body `subject_token`: single-use activation code (opaque string, not JWT).
   *       for an `initial_access_token`.
   *       The validated route selects the tenant. Firebase `tenant_id` is optional; when
   *       present it must match the route and cannot redirect the exchange.
   *
   *       Submit-time errors are returned immediately if the request cannot be accepted/enqueued.
   *       Processing/business errors are returned when polling.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/InitialAccessTokenExchangePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *       '400': { description: Bad Request. }
   *       '401': { description: Missing/invalid Firebase id_token. }
   *       '404': { description: Activation code not found. }
   *       '409': { description: Activation code already used. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_recover:
   *   post:
   *     tags:
   *       - 2.1.2 Initial Access Token Exchange
   *     summary: Replace an employee wallet after fresh email OTP (async)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_recover`.
   *
   *       This employee-only recovery action requires a Firebase `id_token`
   *       minted by a fresh email OTP ceremony (maximum age five minutes) and
   *       the already registered `client_instance_id`. GW requires exact
   *       verified-email ownership of the active employee seat, rotates its
   *       activation credential and returns it only to the trusted BFF/SDK so
   *       DCR can replace the installation keys. The credential is never
   *       returned to the browser. This flow does not decrypt or recover the
   *       old wallet seed and does not require the old PIN.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the replacement credential. }
   *       '400': { description: Bad request or missing installation id. }
   *       '401': { description: Missing, invalid or stale email-OTP identity proof. }
   *       '403': { description: Verified email does not own the employee installation. }
   *       '404': { description: Active employee installation not found. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/License/_issue:
   *   post:
   *     tags:
   *       - 2.1.4 License Issuance (Invite)
   *     summary: Issue (reserve) an activation code from the tenant license pool (async)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_issue`.
   *       This `identity/openid` route is maintained as a temporary compatibility alias.
   *
   *       Tenant-admin / IT operation that reserves one `device-licenses` seat for a target email+role
   *       and returns the seat activation credential for subsequent `Token/_exchange`.
   *       The same credential can activate distinct installations up to `maxDevices`
   *       (five by default); it does not consume another employee seat.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             newEmployee: { $ref: '#/components/examples/LicenseIssuePlaintextMessage' }
   *             existingEmployee: { $ref: '#/components/examples/LicenseIssueExistingEmployeePlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             newEmployeeJson: { $ref: '#/components/examples/LicenseIssuePlaintextMessage' }
   *             existingEmployeeJson: { $ref: '#/components/examples/LicenseIssueExistingEmployeePlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/License/_add:
   *   post:
   *     tags:
   *       - Organization Licences
   *     summary: Add explicit zero-cost organization seats on non-production test networks
   *     description: |
   *       Controller-authorized simulation restricted to non-production
   *       `NETWORK_MODE=test`, `local-network`, or `test-network`. The request must carry professional
   *       licence category, an explicit zero price and a positive quantity.
   *       It creates available seats only and never reassigns an existing
   *       representative, technical controller or member. `prod` or `network` rejects
   *       this shortcut and requires the signed payment plus Order lifecycle.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *       '403': { description: Zero-cost professional additions are unavailable outside Test Network. }
   *
 * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response:
 *   post:
   *     tags:
   *       - 2.1.2 Initial Access Token Exchange
   *     summary: Poll the initial_access_token exchange result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TokenExchangePollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TokenExchangePollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/InitialAccessTokenExchangeResponse' }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Person/_batch:
   *   post:
   *     tags:
   *       - 99. Legacy / Internal
  *     summary: Create a Person (individual vault)
   *     description: |
   *       This endpoint existed for the older "customer onboarding" flow where a provider created an individual's vault directly.
   *
  *       This endpoint remains available for the phone-validated form bootstrap path used by the chat node and other compatibility clients.
  *       New portal integrations should use the tenant organization activation + individual indexing flow documented in the current SDK guides.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Legacy endpoint. Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/CustomerCreationLegacy'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/CustomerOnboardingPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CustomerCreationLegacy'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted. The job has been queued.
   *         headers:
   *           Location:
   *             schema: { type: string }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch:
   *   post:
   *     tags:
   *       - 5. Consent
   *     summary: Create a FHIR Consent Resource
   *     description: Submits an async job to create a FHIR Consent resource, wrapped in a DIDComm message.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/ConsentCreation'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/ConsentCreationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/ConsentCreation'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/fhir+json:
   *           schema:
   *             type: object
   *           description: |
   *             Legacy FHIR JSON (raw Bundle without DIDComm envelope). Allowed only in non-production environments and only for `org.hl7.fhir.*` endpoints.
   *             This mode is still asynchronous: submit with `_batch` and poll `_batch-response`.
   *     responses:
   *       '202':
   *         description: Accepted.
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Consent/_batch-response:
   *   post:
   *     tags:
   *       - 5. Consent
   *     summary: Poll the Consent job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch:
   *   post:
   *     tags:
   *       - 6. Communication
   *     summary: Create a FHIR Communication Resource
   *     description: Submits an async job to create a FHIR Communication resource, wrapped in a DIDComm message, subject to a prior Consent.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/CommunicationCreation'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/CommunicationCreationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/CommunicationCreation'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/fhir+json:
   *           schema:
   *             type: object
   *           description: |
   *             Legacy FHIR JSON (raw Bundle without DIDComm envelope). Allowed only in non-production environments and only for `org.hl7.fhir.*` endpoints.
   *             This mode is still asynchronous: submit with `_batch` and poll `_batch-response`.
   *     responses:
   *       '202':
   *         description: Accepted.
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Communication/_batch-response:
   *   post:
   *     tags:
   *       - 6. Communication
   *     summary: Poll the Communication job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/RelatedPersonPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/RelatedPersonPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch:
   *   post:
   *     tags:
   *       - 7. Composition
   *     summary: Update the Unified Health Index (FHIR Composition)
   *     description: Submits an async job to update the individual's index using a FHIR Composition bundle entry.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/CompositionUpdatePlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/fhir+json:
   *           schema:
   *             type: object
   *           description: |
   *             Legacy FHIR JSON (raw Bundle without DIDComm envelope). Allowed only in non-production environments and only for `org.hl7.fhir.*` endpoints.
   *             This mode is still asynchronous: submit with `_batch` and poll `_batch-response`.
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202':
   *         description: Accepted.
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch-response:
   *   post:
   *     tags:
   *       - 7. Composition
   *     summary: Poll the Composition job result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/ObservationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/ObservationPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/ResearchSubject/_purge:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Offboard a subject from the current digital-twin index provider
   *     description: |
   *       Deletes only the tenant-private correspondence between the operational
   *       subject DID and its registered twin UUID. The anonymous twin is not
   *       deleted. This operation is for account deletion or index-provider
   *       migration, never for an ordinary secondary-use consent toggle.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [thid, body]
   *             properties:
   *               thid: { type: string }
   *               body:
   *                 type: object
   *                 required: [resourceType, parameter]
   *                 properties:
   *                   resourceType: { type: string, enum: [Parameters] }
   *                   parameter:
   *                     type: array
   *                     items: { type: object }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the matching `_purge-response` path. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
  *     summary: Save a researcher-owned working selection
  *     description: |
  *       Persists only `@type = Composition:ResearcherWorkingSelection` for an
  *       existing tenant-registered `urn:uuid` twin subject. Canonical twins
  *       are projected by GW from subject data after secondary-use consent;
  *       they cannot be submitted through this endpoint.
  *
  *       Claims container note:
  *       - `resource.meta.claims` is a project-specific non-standard claims container
  *       - it is not part of base FHIR
  *       - the resource remains FHIR-shaped, but business semantics are claims-first
  *       - claims may be contextualized with `@context` such as `org.hl7.fhir.api`
  *         or authored in a less-qualified form when that context already disambiguates them
  *
  *       Expected payload shape:
  *       - DIDComm plaintext message
  *       - `body.data[]` array
  *       - each item is a Composition resource object with:
  *         - `resource.meta.claims` for Composition claims
   *         - optional `resource.contained[].meta.claims` for source resources
   *           (`DocumentReference`, and future `Encounter` / `Patient`)
   *
  *       Current gateway behavior rejects operational subject DIDs, invented
  *       UUID URNs absent from the private alias registry, and canonical twin
  *       Compositions.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/ResearchCompositionIngestionPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Save a researcher-owned working selection in strict FHIR R4 mode
   *     description: |
   *       Same working-selection flow as `org.hl7.fhir.api`, but with version-aware validation.
   *       Each item must include `resource.resourceType = "Composition"`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/ResearchCompositionSearchPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Search digital twins by IPS sections, clinical date range and text
   *     description: |
   *       Submits an async section-first digital twin search request.
   *
   *       Public search intent:
   *       - the result artifact is `ResearchSubject`
   *       - each match exposes `composition`, the canonical Composition GW
   *         uses internally to index that ResearchSubject and connect its resources
   *       - repeated `section` parameters use OR semantics and each section may
   *         span several resource families
   *       - inclusive `date-from` and non-empty `text` are required
   *       - inclusive `date-to` is optional; GW resolves an omitted value to
   *         its current time for that request
   *       - text is matched case/accent-insensitively against a private derived
   *         search document, not exposed clinical free text
   *       - internal matching may fan out to indexed resource families for the
   *         requested section, but the response returns matched `ResearchSubject`
   *         aggregates rather than leaf resources
   *
   *       Current runtime rules:
   *       - request body should carry a FHIR `Parameters` resource
   *       - `section` is required
   *       - section OR, text and date constraints are combined with AND and
   *         text/date must match the same clinical resource
   *       - matched subjects are deduplicated before returning ResearchSubjects
   *       - advanced resource-scoped filters remain compatibility input
   *       - poll completion on the existing `_batch-response` path with the
   *         same `thid`
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *           examples:
   *             message: { $ref: '#/components/examples/ResearchCompositionSearchPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the `_batch-response` URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/ResearchSubject/_batch-response:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Poll a ResearchSubject search submitted in FHIR API format
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed ResearchSubject search. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Search strict FHIR R4 digital twins by sections, date range and text
   *     description: |
   *       Same section-first digital twin search contract as
   *       `org.hl7.fhir.api/ResearchSubject/_search`, but with the versioned
   *       format segment used by strict FHIR clients.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the `_batch-response` URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_batch-response:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Poll a ResearchSubject search submitted in strict FHIR R4 format
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed ResearchSubject search. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Poll strict FHIR R4 research digital twin ingestion result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch-response:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Poll research digital twin ingestion result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/CompositionPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch:
   *   post:
   *     tags:
   *       - 4.3 Family Member Relationship
   *     summary: Register a family member relationship (emergency contact)
   *     description: |
   *       Stores a relationship/emergency-contact record for an individual using contextualized flat claims (`@context: org.hl7.fhir.api`).
   *       This is intended for family-controlled or self-managed emergency contacts and non-clinical context.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_batch-response:
   *   post:
   *     tags:
   *       - 4.3 Family Member Relationship
   *     summary: Poll the relationship registration result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TenantOrganizationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TenantOrganizationPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Observation/_batch:
   *   post:
   *     tags:
   *       - 8.4 Personal Observations
   *     summary: Collect personal (non-clinical) observations
   *     description: |
   *       Collects non-clinical observations created by the individual (or their family controller) for emergencies and care continuity.
   *       These observations are not "official clinical data"; they are self-reported and intended for context and emergency use.
   *
   *       Use contextualized flat claims with `@context: org.hl7.fhir.api` (keys like `Observation.category`, `Observation.code`, `Observation.valueString`, etc.).
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/json:
   *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/SecureRequest' }
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Observation/_batch-response:
   *   post:
   *     tags:
   *       - 8.4 Personal Observations
   *     summary: Poll the observation collection result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TenantOrderPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/TenantOrderPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_batch:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Create or update Subject profile (claims-first)
  *     description: |
  *       Creates or updates One Health Subject profiles using contextualized flat claims (`@context: org.hl7.fhir.api`).
  *
  *       Claims container note:
  *       - `resource.meta.claims` is a project-specific non-standard claims container
  *       - it is not part of base FHIR
  *       - `@context` may be `org.hl7.fhir.api`, `org.schema`, or another supported context
  *       - when `@context` is already present, keys may be written in a less-qualified form
  *         instead of always repeating the full reverse-DNS prefix
  *
  *       Contract notes:
  *       - Endpoint may autofill `@context` and `@type` if omitted.
  *       - `@type` (when provided) can be `Person`, `Animal`, or `Thing`.
  *       - `Subject.id` is immutable once created.
  *       - `Subject.organization` (`did:web` of Individual Organization) can be updated and must be auditable.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/_batch-response:
  *   post:
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Poll the Subject profile operation result
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *           examples:
  *             message: { $ref: '#/components/examples/TenantOrderPollRequest' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
  *           examples:
  *             message: { $ref: '#/components/examples/TenantOrderPollRequest' }
  *     responses:
  *       '202': { description: Pending. Retry later. }
  *       '200': { description: Completed. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary:
  *   post:
  *     x-contract-level: internal-compatibility
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Internal compatibility operation for subject summary resolution
  *     description: |
  *       This HTTP route is an internal operation reference and lower-level
  *       compatibility surface. Application and BFF code must use the actor-facade
  *       `requestClinicalSummary(...)` method. That method submits an auditable
  *       `Communication` through `Communication/_batch`; GW then resolves
  *       `Subject/$summary` internally and returns the Parameters/Bundle result through
  *       the same Communication lifecycle.
  *
  *       Current enablement:
  *       - sectors starting with `health-`
  *       - sectors starting with `animal-`
  *       - sectors starting with `onehealth-`
  *
  *       Contract notes:
  *       - requests travel in the project DIDComm/FAPI envelope and batch conventions
  *       - `resource.meta.claims` remains the canonical non-standard claims carrier for
  *         FHIR-like resources in those envelopes
  *       - `Subject/$summary` is the canonical internal operation name, not the public
  *         application transport boundary.
  *       - `Patient/$summary` is a compatibility alias with the same behavior.
  *       - request body should be a FHIR `Parameters` resource
  *       - minimum required parameter is `subject`
  *       - optional parameters include `document-type`, `section`, and `exclude-section`
  *
  *       See also:
  *       - `gdc-common-utils-ts/docs/101-COMMUNICATION_LAYERING.md`
  *       - `gdc-sdk-core-ts/docs/101-IPS_COMMUNICATION_OUTBOX.md`
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the result. }
  *
  * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$summary:
  *   post:
  *     x-contract-level: internal-compatibility
  *     tags:
  *       - 8.1 Subject Profile
  *     summary: Compatibility alias for Subject summary
  *     description: |
  *       Alias of `Subject/$summary` kept for healthcare-oriented clients.
  *       New cross-sector code should prefer `Subject/$summary`.
  *     parameters:
  *       - $ref: '#/components/parameters/AppId'
  *       - $ref: '#/components/parameters/AppVersion'
  *       - $ref: "#/components/parameters/TenantId"
  *       - $ref: "#/components/parameters/Jurisdiction"
  *       - $ref: "#/components/parameters/Sector"
  *     requestBody:
  *       required: true
  *       content:
  *         application/didcomm-plain+json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/json:
  *           schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
  *         application/x-www-form-urlencoded:
  *           schema: { $ref: '#/components/schemas/SecureRequest' }
  *     security:
  *       - BearerAuth: []
  *     responses:
  *       '202': { description: Accepted. Poll the Location URL for the result. }
   * 
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch:
   *   post:
   *     tags:
   *       - 1.2 Organization Order
   *     summary: Confirm the organization registration order (host)
   *     description: |
   *       Step 2 of onboarding. Submits an Order that accepts a prior Offer from Step 1 (tenant registration).
   *       The Offer ID is supplied in the request body as Order.acceptedOffer.identifier and must match the
   *       Offer returned by the Organization activation `_activate-response`.
   *       This step is always required (including `0` amount offers).
   *       When the Offer came from legacy legal-organization onboarding, GW builds
   *       the representative controller before tenant finalization and includes
   *       that controller DID in the organization DID from version one.
   *       The final polled result typically contains payment/checkout claims and the first controller
   *       activation code (`org.schema.IndividualProduct.serialNumber`).
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/OrganizationOrderPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the organization registration result (host)
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_batch`.
   *
   *       Submit vs poll behavior:
   *       - Submit (`_batch`) returns immediate errors if the request cannot be accepted/enqueued.
   *       - Poll (`_batch-response`) returns `202` while pending, then `200` (success) or `500` (processing error).
   *
   *       Response format depends on the original submission flow:
   *       - Legacy/plaintext: returns JSON.
   *       - Secure (form-encoded JWE): returns `application/x-www-form-urlencoded` with `response=<jwe>`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationRegistrationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationRegistrationPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *             examples:
   *               message: { $ref: '#/components/examples/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *             examples:
   *               message: { $ref: '#/components/examples/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Activation
   *     summary: Poll the organization activation result (host)
   *     description: |
   *       Polls the asynchronous job submitted to `.../Organization/_activate`.
   *
   *       Submit vs poll behavior:
   *       - Submit (`_activate`) returns immediate errors if the request cannot be accepted/enqueued.
   *       - Poll (`_activate-response`) returns `202` while pending, then `200` (success) or `500` (processing error).
   *
   *       Response format depends on the original submission flow:
   *       - Plaintext: returns JSON.
   *       - Secure (form-encoded JWE): returns `application/x-www-form-urlencoded` with `response=<jwe>`.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed. Returns either JSON (plaintext) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/OrganizationActivationResponseBundle' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response:
   *   post:
   *     tags:
   *       - 1.2 Organization Order
   *     summary: Poll the organization order result (host)
   *     description: |
   *       Polls the asynchronous job submitted to `.../Order/_batch`. The `jurisdiction` and `sector` are path routing parameters for the host registry.
   *       The completed response returns a Bundle entry with order invoice claims plus one embedded invoice
   *       `resource` Bundle containing a FHIR `Invoice`, one PDF `DocumentReference`, and one structured
   *       `DocumentReference` carrying JSON/XML invoice payloads. `org.schema.Order.partOfInvoice` and
   *       `org.schema.Order.paymentUrl` remain as flat compatibility claims for legacy readers.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/HostRegistrySector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationOrderPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/OrganizationOrderPollRequest' }
   *     responses:
   *       '202':
   *         description: Pending. Retry later.
   *         headers:
   *           Retry-After:
   *             schema: { type: string, example: '5' }
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AsyncPollPending' }
   *       '200':
   *         description: Completed. Returns either JSON (legacy) or `response=<jwe>` (secure).
   *         content:
   *           application/json:
   *             schema: { type: object }
   *             examples:
   *               message: { $ref: '#/components/examples/OrganizationOrderResponseBundle' }
   *           application/x-www-form-urlencoded:
   *             schema: { $ref: '#/components/schemas/AsyncPollSecureResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Register a legacy individual organization offer
   *     description: |
  *       Legacy compatibility endpoint for hosted individual onboarding.
  *       The current portal flow uses tenant organization activation from signed proof and individual indexing in the hosted tenant.
  *
  *       This route also accepts a signed individual onboarding PDF as a DIDComm attachment.
  *       When present, the gateway verifies the PDF signature, extracts the signer certificate
  *       subject, reads the additional form fields, and completes the individual registration claims
  *       without overwriting certificate-derived person identity data.
  *
  *       New integrations should prefer the `_transaction` alias below. `_batch` is kept for compatibility
  *       and will be deprecated after clients migrate.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             viaOnlinePdfLink:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessage'
   *             viaInlineBase64Pdf:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessageInlineBase64'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the Offer result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Register an individual organization transaction with optional signed PDF attachment
   *     description: |
  *       Canonical successor of `.../Organization/_batch` for individual organization onboarding.
  *       The payload shape is the same as `_batch`, but the semantic contract is transactional:
  *       the individual organization, the legal representative/controller claims, and the signed PDF
  *       attachment travel together as one business transaction.
  *
  *       When the DIDComm message includes a PDF attachment (`media_type: application/pdf`), the gateway:
  *       - validates the PDF signature,
  *       - extracts the natural-person certificate subject,
  *       - reads the form fields,
  *       - derives CORE claims from certificate + form,
  *       - and merges them with request claims, preserving certificate-derived identity values as authoritative.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Same payload contract as `_batch`. Production: only `application/x-www-form-urlencoded`
   *         is accepted (secure JWE envelope with `request=`). Demo/Test-Network:
   *         `application/didcomm-plain+json` is canonical, and `application/json`
   *         is also accepted for simplicity.
   *         With `@context: "org.schema"`, clients may send contextualized keys such as `Organization.identifier.value`
   *         or `Service.category` without the `org.schema.` prefix; that is the documented default mode.
   *         If the service enables `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, equivalent fully-qualified `org.schema.*`
   *         keys remain valid. `Service.termsOfService` may be an HTTPS URL or an embedded PDF data URL; Swagger uses
   *         the HTTPS URL form as the default example.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             viaOnlinePdfLink:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessage'
   *             viaInlineBase64Pdf:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessageInlineBase64'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the transaction result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Poll the legacy individual registration result (Offer)
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction-response:
   *   post:
   *     tags:
   *       - 4.1 Family Registration
  *     summary: Poll the individual registration transaction result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch:
   *   post:
   *     tags:
   *       - 4.2 Family Order
  *     summary: Confirm the legacy individual organization order (accept Offer)
   *     description: |
  *       Legacy compatibility only. Submits an Order that accepts the registration Offer to complete the historical onboarding flow.
   *       The Offer ID is supplied in the request body as Order.acceptedOffer.identifier and must match the
   *       Offer returned by the family registration _batch-response.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/FamilyOrderPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response:
   *   post:
   *     tags:
   *       - 4.2 Family Order
  *     summary: Poll the legacy individual order result
   *     description: |
   *       Polls the asynchronous job submitted to `.../Order/_batch`. The `tenantId`, `jurisdiction`, and `sector` are path routing parameters for the tenant's individual registry.
   *       The completed response returns a Bundle entry with order invoice claims plus one embedded invoice
   *       `resource` Bundle containing a FHIR `Invoice`, one PDF `DocumentReference`, and one structured
   *       `DocumentReference` carrying JSON/XML invoice payloads.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/DeviceRegistrationResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_revoke:
   *   post:
   *     tags: [2.1.3 Dynamic Client Registration]
   *     summary: Revoke one employee device while preserving its seat
   *     description: |
   *       Canonical route: `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_revoke`.
   *       A controller supplies `body.license_id` and `body.client_id`. GW revokes
   *       that device profile, its employee DID verification methods and ledger
   *       key bindings. Other devices and the employee licence remain active.
   *     security: [{ BearerAuth: [] }]
   *     responses:
   *       '202': { description: Accepted. Poll the paired `_revoke-response` route. }
   *       '404': { description: Licence or active device binding not found. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr:
   *   post:
   *     tags:
   *       - 2.1.3 Device Registration (DCR)
   *     summary: Register device keys (OpenID DCR)
   *     description: |
   *       Canonical route for new integrations is:
   *       `/host/cds-{jurisdiction}/v1/{sector}/{tenantId}/identity/auth/_dcr`.
   *       This `identity/openid` route is maintained as a temporary compatibility alias.
   *
   *       Registers a device/client using OpenID Dynamic Client Registration. Requires an initial_access_token from Token/_exchange.
   *       Request is usually a secure (form-encoded JWE) DIDComm message; demo plaintext is also accepted.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/DeviceRegistrationPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the result. }
   *
 * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response:
 *   post:
   *     tags:
   *       - 2.1.3 Device Registration (DCR)
   *     summary: Poll the device registration (DCR) result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *           examples:
   *             message: { $ref: '#/components/examples/DeviceRegistrationPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200':
   *         description: Completed.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/DidcommPlaintextMessage' }
   *             examples:
   *               message: { $ref: '#/components/examples/DeviceRegistrationResponse' }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token:
   *   post:
   *     tags:
   *       - 2.2 SMART Token
   *     summary: Request a SMART access_token (async)
   *     description: |
  *       Requests a SMART access token. The request MUST include the gateway context-pinning scope item:
  *       `organization/Composition.<cruds>?subject=<did:web:...:individual:<id>>[&section=*|<code>[,<code>...]]`.
  *       Omitting `section` is allowed and means the backend's default permitted set for that subject.
   *
   *       OpenID4VP binding: the request MUST include `acr_values` from the prior verification event, using
   *       one of: `urn:antifraud:acr:openid4vp:employee` or `urn:antifraud:acr:openid4vp:individual`. The issued
   *       SMART token includes the matching `acr` and SHOULD include `amr` entries like `openid4vp`, `vc`, and
   *       `device_bound`.
   *
   *       Client authentication: the gateway accepts one signed client-authentication JWT in
   *       `body.client_assertion`. The canonical request shape uses the standard parameter names
   *       `client_assertion` + `client_assertion_type`; for compatibility, `client_assertion_type`
   *       may carry either the full JWT-bearer URN or the shorter `private_key_jwt` label.
   *
   *       Proof requirement: the SMART authorization request normally carries one verifiable presentation (VP)
   *       inside the JAR (request object) or the DIDComm payload (demo flow). That VP is validated via the
   *       Gaia-X Clearing House to enforce non-revocation before issuing the token.
   *
   *       Research-access exception: for the inter-tenant `RESEARCH` use case only, the current gateway also
   *       accepts one already-validated external `Bearer data access token` instead of `body.vp_token`, as long
   *       as the trusted issuer, provider tenant, consumer organization, purpose, and requested capability match.
   *
   *       Contract boundary: the inter-tenant FHIR `Contract` VC gate applies
   *       to `organization/ResearchSubject.*` digital-twin capabilities.
   *       Individual `organization/Composition.*` self-read still requires
   *       one verified VP and matching FHIR `Consent`, but not a research
   *       contract solely because its public DID root differs from the
   *       operator DID serving the endpoint.
   *
   *       Demo payload note: in this endpoint the DIDComm `body` represents the JAR (authorize request object),
   *       including PKCE parameters (`code_challenge`, `code_challenge_method`), `client_id`, `redirect_uri`,
   *       `client_assertion`, `client_assertion_type`, `vp_token`, optional `presentation_submission`, and
   *       `acr_values`.
   *
   *       The worker will validate the target subject exists and that at least one consent rule matches the actor.
   *
   *       Optional `body.break_glass` is a disabled-by-default GW CORE extension for exceptional
   *       emergency reads. Human access is confined to `health-care` with a
   *       ledger-verified physician credential; animal access is confined to `animal-care` with
   *       a ledger-verified veterinarian credential. Research and One Health research routes,
   *       write scopes, employment alone and cross-subject-kind requests fail closed. The worker
   *       persists and anchors a flat-claims `ETREAT` Consent for up to the configured 24-hour
   *       episode, then requires controller-mailbox Communication acknowledgement. Each issuance
   *       appends a correlated Fabric event and returns a read-only token for at most 15 minutes;
   *       repeated issuance reuses the active Consent without extending its period.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/SmartTokenRequestPlaintextMessage'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll `.../identity/openid/smart/_batch-response` with `thid`. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response:
   *   post:
   *     tags:
   *       - 2.2 SMART Token
   *     summary: Poll the SMART token issuance result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   */
  /**
   * @openapi
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/did/document/_binding:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Bind the tenant DID document public aliases
   *     description: |
   *       Updates the tenant DID document public alias projection managed by GW CORE.
   *
   *       Step by step:
   *       - this is a tenant-scoped GW operation
   *       - it is distinct from host `Organization/_transaction`
   *       - it is distinct from legacy ICA `_verify -> Organization/_activate`
   *       - `organization.url` provides the public alias/domain list projected into `alsoKnownAs`
   *       - the tenant path already identifies the organization; no extra organization locator is required in the payload
   *
   *       Replacement rule:
   *       - when `organization.url` is provided, the resolved alias list replaces the current `alsoKnownAs`
   *       - when omitted, the current alias list is preserved
   *
   *       Key-management rule:
   *       - this operation does not rotate or replace organization public keys
   *       - `controller.sameAs` is optional corroborating identity material only
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plain+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plain+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *         application/x-www-form-urlencoded:
   *           schema:
   *             $ref: '#/components/schemas/SecureRequest'
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       '202': { description: Accepted. Poll the Location URL for the binding result. }
   *
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/did/document/_binding-response:
   *   post:
   *     tags:
   *       - 1.1 Organization Registration
   *     summary: Poll the tenant DID document binding result
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: '#/components/parameters/TenantId'
   *       - $ref: '#/components/parameters/Jurisdiction'
   *       - $ref: '#/components/parameters/Sector'
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
   *       '400': { description: Missing or invalid thid. }
   *       '404': { description: thid not found. }
   *       '500': { description: Job failed or response decode failed. }
   */
  // --- 1. ASYNC JOB SUBMISSION ENDPOINT ---
  router.post(didDocumentBindingRoute, async (req, res, next) => {
    const action = String(req.params.action || '').trim();
    if (action !== '_binding') return next();

    req.params = {
      ...req.params,
      section: 'did',
      format: 'document',
      resourceType: 'Document',
    } as any;

    const routeParams = req.params as unknown as RouteParams;
    const { tenantId, section, resourceType, sector } = routeParams;
    const contentTypeHeader = String(req.headers['content-type'] || '');
    const contentType = normalizeContentType(contentTypeHeader);
    const parsedContentType = parseIncomingContentType(contentType);
    let jobRequest: JobRequest;

    try {
      if (!isContentTypeAllowedBySecurityPolicy(parsedContentType)) {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type for current SECURITY_MODE: ${contentTypeHeader || '<missing>'}`,
        );
      }

      if (parsedContentType !== 'didcomm-plain' && parsedContentType !== 'json') {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type for did/document/_binding: ${contentTypeHeader || '<missing>'}`,
        );
      }

      const authToken = req.headers.authorization;
      const enforceBearerValidation = !allowsInsecureBearerBySecurityMode();
      const requireBearerHeader = !allowsInsecureBearerBySecurityMode();
      let verifiedBearerPayload: Record<string, any> = {};
      if (requireBearerHeader && (!authToken || !authToken.startsWith('Bearer '))) {
        return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
      }
      if (enforceBearerValidation) {
        if (!appAuthManager) {
          return sendDidcommEarlyError(
            req,
            res,
            500,
            IssueType.Exception,
            'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
          );
        }
        try {
          const bearerToken = authToken?.split(' ')[1] || '';
          const verificationResult = await appAuthManager.verifyBearerToken(
            bearerToken,
            undefined,
            await controllerProofRegistrationContext(tenantId, sector),
          );
          verifiedBearerPayload = getVerifiedBearerPayload(verificationResult);
        } catch (error: any) {
          return sendDidcommEarlyError(
            req,
            res,
            401,
            IssueType.Security,
            `Invalid Bearer token: ${error?.message || 'verification failed'}`,
          );
        }
      }

      const legacyBody = normalizeDidcommBodyForFhirFormat(req.body || {}, routeParams.format);
      const normalizedLegacyContent = normalizeLegacyPlaintextContent(legacyBody || {});
      const legacyMeta = normalizedLegacyContent?.meta || {};

      jobRequest = {
        ...(routeParams as any),
        id: '',
        sequence: 0,
        status: 'DRAFT' as any,
        createdAtTimestamp: Date.now(),
        content: {
          ...normalizedLegacyContent,
          meta: {
            ...legacyMeta,
            bearer: {
              token: authToken,
              jwt: { header: { alg: '', kid: '' }, payload: verifiedBearerPayload },
            },
          },
        },
        contentType: contentType,
      };
    } catch (error: any) {
      console.error('[API] Error during did/document/_binding request processing:', error);
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Security,
        'Failed to process request: ' + error.message,
      );
    }

    const thid = jobRequest.content?.thid;
    if (!thid) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        'Request body must contain a "thid" or "id" property.',
      );
    }

    const vaultId = await resolveVaultId(tenantId, sector);
    const tenantServices = await tenantsCacheManager.getDidServiceConfig(vaultId);

    if (!isRequestValid(tenantServices, { ...routeParams, action })) {
      return sendDidcommEarlyError(
        req,
        res,
        404,
        IssueType.NotFound,
        'The requested tenant or endpoint path does not exist.',
      );
    }

    if (requiresActiveTenantAuthorization(tenantId, section, routeParams.format, resourceType, action)) {
      const tenantConfigForAuthorization = await tenantsCacheManager.getTenant(vaultId);
      const authorizationStatus = tenantConfigForAuthorization
        ? readTenantAuthorizationStatusFromConfig(tenantConfigForAuthorization)
        : undefined;
      if (!authorizationStatus) {
        return sendDidcommEarlyError(req, res, 404, IssueType.NotFound, 'The requested tenant or endpoint path does not exist.');
      }
      if (authorizationStatus !== 'active') {
        return sendDidcommEarlyError(req, res, 403, IssueType.Forbidden, `Tenant authorization is ${authorizationStatus}.`);
      }
    }

    const iss = String(jobRequest.content?.iss || '').trim();
    const jti = String(jobRequest.content?.jti || '').trim();
    if (iss && jti) {
      const replayKey = `${vaultId}:${iss}:${jti}`;
      const reserved = await replayProtectionStore.reserveIfNotExists(
        replayKey,
        getReplayTtlSeconds(jobRequest.content),
      );
      if (!reserved) {
        return sendDidcommEarlyError(req, res, 409, IssueType.Conflict, 'Duplicate jti detected for this issuer (possible replay).');
      }
    }

    const jobName = createJobName(vaultId, 'Document', action);
    jobRequest.action = action;
    await queueAdapter.addJob(jobName, jobRequest);
    asyncResponseStore.set(thid, { status: 'PENDING', vaultId: vaultId });

    const relativeUrl = `${req.originalUrl}-response`;
    const requestBaseUrl = getRequestBaseUrl(req, apiBaseUrl);
    const pollingUrl = new URL(relativeUrl, requestBaseUrl).href;
    res.location(pollingUrl);
    res.set('Retry-After', '5');
    res.status(202).send();
  });

  router.post(`${cdsRoutePrefix}/:action`, async (req, res) => {
    const normalizedParams = normalizeUnifiedIdentityAuthRouteParams(req.params as unknown as RouteParams);
    req.params = { ...req.params, ...normalizedParams };
    const { tenantId, section, resourceType, sector, action } = req.params;
    const format = String(req.params.format || '').toLowerCase();
    const normalizedResourceType = String(resourceType || '').toLowerCase();
    const normalizedAction = String(action || '').trim();
    const isLegacyHostOrganizationSubmit = tenantId === 'host'
      && section === 'registry'
      && format === 'org.schema'
      && normalizedResourceType === 'organization'
      && (normalizedAction === '_batch' || normalizedAction === '_verify');
    if (isLegacyHostOrganizationSubmit) {
      console.warn(
        '[API] Legacy host onboarding endpoint used (Organization/_batch or alias _verify). '
        + 'Prefer Organization/_transaction for canonical ICA-backed onboarding. '
        + 'Organization/_activate remains legacy compatibility for ICA-proof-first callers.',
      );
    }
    const contentTypeHeader = String(req.headers['content-type'] || '');
    const contentType = normalizeContentType(contentTypeHeader);
    const parsedContentType = parseIncomingContentType(contentType);
    let jobRequest: JobRequest;
    let verifiedBearerPayload: Record<string, any> = {};

    try {
      if (!isContentTypeAllowedBySecurityPolicy(parsedContentType)) {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type for current SECURITY_MODE: ${contentTypeHeader || '<missing>'}`,
        );
      }

      // --- 1. Payload Handling & JobRequest Construction ---
      if (parsedContentType === 'secure-form') {
        // ENCRYPTED FLOW (FAPI/JAR-style)
        if (!req.body.request) {
          return sendDidcommEarlyError(
            req,
            res,
            400,
            IssueType.Required,
            "Missing 'request' parameter in form-encoded body.",
          );
        }
        const authToken = req.headers.authorization;
        const allowNoBearerForActivate = isHostOrganizationActivateRoute(
          tenantId,
          section,
          req.params.format,
          resourceType,
          action,
        );
        const isIdentityDcrRoute =
          section === 'identity'
          && String(req.params.format || '').toLowerCase() === 'openid'
          && String(resourceType || '').toLowerCase() === 'device'
          && action === '_dcr';
        const requireBearerHeader = section !== 'ping' && !allowNoBearerForActivate;
        if (requireBearerHeader && (!authToken || !authToken.startsWith('Bearer '))) {
          return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
        }
        if (requireBearerHeader && !isIdentityDcrRoute) {
          if (!appAuthManager) {
            return sendDidcommEarlyError(
              req,
              res,
              500,
              IssueType.Exception,
              'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
            );
          }
          try {
            const bearerToken = authToken?.split(' ')[1] || '';
            const verificationResult = await appAuthManager.verifyBearerToken(
              bearerToken,
              undefined,
              await controllerProofRegistrationContext(tenantId, sector),
            );
            verifiedBearerPayload = getVerifiedBearerPayload(verificationResult);
          } catch (error: any) {
            return sendDidcommEarlyError(
              req,
              res,
              401,
              IssueType.Security,
              `Invalid Bearer token: ${error?.message || 'verification failed'}`,
            );
          }
        }
        // The KMS decrypts the JWE using the HOST's key and returns the inner JWS, but does not verify it.
        const decodedJob = await kmsService.decodeRequest(req.body.request);
        // The Bearer token (e.g., Firebase id_token) is still an HTTP concern, but some identity endpoints
        // need it during async processing. We propagate it into the decoded payload meta for the worker.
        const bearerToken = req.headers.authorization;
        if (bearerToken) {
          (decodedJob as any).content = (decodedJob as any).content || {};
          (decodedJob as any).content.meta = (decodedJob as any).content.meta || {};
          (decodedJob as any).content.meta.bearer = {
            token: bearerToken,
            jwt: { header: {}, payload: verifiedBearerPayload },
          };
        }

        // --- Signature Verification & Sender Key Resolution (Orchestrator Logic) ---
        // If the sender's public key is not embedded, we must resolve it and verify the signature now.
        if (!decodedJob.content?.meta?.jwe?.header?.jwk) {
          const senderDid = decodedJob.content?.iss;
          const jwsToVerify = decodedJob.content?.meta?.jws;

          if (!senderDid || !jwsToVerify || !jwsToVerify.protected || !jwsToVerify.signature || !jwsToVerify.protected.kid) {
            throw new Error("Secure request is missing 'iss', 'kid', or a valid JWS structure.");
          }
          const senderSigningKeyId = jwsToVerify.protected.kid;
          const senderEncryptionKeyId = decodedJob.content?.meta?.jwe?.header?.skid;
          if (!senderEncryptionKeyId) {
            throw new Error("Secure request is missing 'skid' in the JWE protected header.");
          }

          // 1. Resolve registered sender-key custody independently from job
          // routing. Host commercial Orders are queued in `host` but signed by
          // the tenant controller that authored the accepted Offer.
          const vaultId = await resolveRegisteredSenderVaultId(
            tenantId,
            sector,
            section,
            req.params.format,
            resourceType,
            action,
            senderDid,
          );
          const collectionName = await tenantsCacheManager.getCollectionName(vaultId);
          if (!collectionName) {
            throw new Error(`Could not resolve collectionName for vaultId '${vaultId}'`);
          }
          
          // 2. Protect query parameters using HMAC (Secure Query Pattern).
          const protectedAttrName = await kmsService.getHmacBase64Url('kid', vaultId);
          const protectedAttrValue = await kmsService.getHmacBase64Url(senderSigningKeyId, vaultId);

          // 3. Query the vault for the sender's encrypted document.
          // Prefer the tenant's physical collectionName, but fall back to legacy vaultId storage.
          let queryResult = await vaultRepository.query(collectionName, {
            sectionId: getEnvSectionId('employees'), // Employees are the primary actors who can sign.
            where: [{ name: protectedAttrName, value: protectedAttrValue }],
          });
          if (!queryResult || queryResult.length === 0) {
            queryResult = await vaultRepository.query(vaultId, {
              sectionId: getEnvSectionId('employees'),
              where: [{ name: protectedAttrName, value: protectedAttrValue }],
            });
          }
          let employeeConfig: EntityConfig | undefined;
          if (!queryResult || queryResult.length === 0) {
            // DCR versions deployed before the key-index repair updated the
            // protected employee DID document but retained its bootstrap kid
            // indexes. Scan only the already-resolved tenant scopes on an
            // indexed miss and still require an exact issuer + signing kid +
            // encryption kid match. This is a fail-closed compatibility path,
            // not authority derived from the incoming envelope.
            const scopes = Array.from(new Set([collectionName, vaultId]));
            for (const scope of scopes) {
              let employeeDocs: ConfidentialStorageDoc[] = [];
              try {
                employeeDocs = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
                  scope,
                  getEnvSectionId('employees'),
                );
              } catch {
                continue;
              }
              for (const candidate of employeeDocs) {
                try {
                  const config = await kmsService.unprotectConfidentialData<EntityConfig>(candidate, vaultId);
                  const methods = config.didDocument?.verificationMethod || [];
                  const hasSigningKid = methods.some((method) => (
                    String(method.publicKeyJwk?.kid || '').trim() === senderSigningKeyId
                    || String(method.id || '').endsWith(`#${senderSigningKeyId}`)
                  ));
                  const hasEncryptionKid = methods.some((method) => (
                    String(method.publicKeyJwk?.kid || '').trim() === senderEncryptionKeyId
                    || String(method.id || '').endsWith(`#${senderEncryptionKeyId}`)
                  ));
                  if (String(config.didDocument?.id || '').trim() === senderDid && hasSigningKid && hasEncryptionKid) {
                    queryResult = [candidate];
                    employeeConfig = config;
                    break;
                  }
                } catch {
                  // An inaccessible employee cannot authenticate a request.
                }
              }
              if (employeeConfig) break;
            }
          }
          if (!queryResult || queryResult.length === 0) {
            throw new Error(`Could not find an entity with key ID '${senderSigningKeyId}' in vault '${vaultId}'.`);
          }

          // 4. Unprotect the document to get the sender's full config.
          const employeeDoc = queryResult[0];
          employeeConfig ||= await kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);

          // 5. Find the specific public keys that match the key IDs.
          const signingVerificationMethod = employeeConfig.didDocument?.verificationMethod?.find(
            (vm: VerificationMethod) => vm.id.endsWith(`#${senderSigningKeyId}`)
          );
          const encryptionVerificationMethod = employeeConfig.didDocument?.verificationMethod?.find(
            (vm: VerificationMethod) => vm.id.endsWith(`#${senderEncryptionKeyId}`)
          );
          const senderSigningKey = signingVerificationMethod?.publicKeyJwk;
          const senderEncryptionKey = encryptionVerificationMethod?.publicKeyJwk;
          
          if (!senderSigningKey) {
            throw new Error(`Signing key ID '${senderSigningKeyId}' not found in resolved DID document for '${senderDid}'.`);
          }
          if (!senderEncryptionKey) {
            throw new Error(`Encryption key ID '${senderEncryptionKeyId}' not found in resolved DID document for '${senderDid}'.`);
          }

          // 6. Verify the JWS signature.
          // The cryptographic `meta` field is added by the server after decryption and is not part of the signed payload.
          const signedPayload = { ...(decodedJob.content as any) };
          delete (signedPayload as any).meta;
          const protectedHeaderB64Url = Content.objectToRawBase64UrlSafe(jwsToVerify.protected);
          const detachedJws = `${protectedHeaderB64Url}..${jwsToVerify.signature}`;
          const isValid = await cryptographyService.verifyDetachedJws(
            Content.objectToBytes(signedPayload),
            detachedJws,
            senderSigningKey
          );
          if (!isValid) {
            throw new Error('Invalid signature.');
          }

          // 7. Enrich the job request with the resolved & verified key for the worker.
          // The worker needs this to encrypt the response.
          if (decodedJob.content?.meta?.jwe?.header) {
            decodedJob.content.meta.jwe.header.jwk = senderEncryptionKey as JWK;
          }
        }
        
        // Path parameters are authoritative for routing and must override any values embedded in the payload.
        const normalizedSecureContent = normalizeDidcommBodyForFhirFormat(
          decodedJob.content as any,
          req.params.format,
        );
        jobRequest = {
          ...decodedJob,
          ...req.params,
          content: normalizedSecureContent,
          contentType: contentType,
        };

      } else if (
        parsedContentType === 'didcomm-plain' ||
        parsedContentType === 'json' ||
        parsedContentType === 'fhir'
      ) {
        // LEGACY / PLAINTEXT FLOW (demo/dev convenience)
        const authToken = req.headers.authorization;
        const allowNoBearerForActivate = isHostOrganizationActivateRoute(
          tenantId,
          section,
          req.params.format,
          resourceType,
          action,
        );
        const enforceBearerValidation = !allowsInsecureBearerBySecurityMode();
        // The 'ping' endpoint is a public health check and does not require authentication for legacy requests.
        const requireBearerHeader =
          section !== 'ping'
          && !allowNoBearerForActivate
          && !allowsInsecureBearerBySecurityMode();
        if (requireBearerHeader && (!authToken || !authToken.startsWith('Bearer '))) {
          return sendDidcommEarlyError(req, res, 401, IssueType.Security, 'Missing or invalid Bearer token.');
        }

        if (section !== 'ping' && !allowNoBearerForActivate && enforceBearerValidation) {
          if (!appAuthManager) {
            return sendDidcommEarlyError(
              req,
              res,
              500,
              IssueType.Exception,
              'Bearer validation is required by SECURITY_MODE but AppAuthorizationManager is not configured.',
            );
          }
          try {
            const bearerToken = authToken?.split(' ')[1] || '';
            const verificationResult = await appAuthManager.verifyBearerToken(
              bearerToken,
              projectedControllerProofJwk(req.body),
              await controllerProofRegistrationContext(tenantId, sector),
            );
            verifiedBearerPayload = getVerifiedBearerPayload(verificationResult);
          } catch (error: any) {
            return sendDidcommEarlyError(
              req,
              res,
              401,
              IssueType.Security,
              `Invalid Bearer token: ${error?.message || 'verification failed'}`,
            );
          }
        }

        if (
          appAuthManager &&
          section === 'identity' &&
          String(req.params.format || '').toLowerCase() === 'openid' &&
          String(resourceType || '').toLowerCase() === 'device' &&
          action === '_dcr'
        ) {
          // DCR is gated by an `initial_access_token` (host-signed) to consume a license seat securely.
          const bearerToken = authToken?.split(' ')[1];
          if (!bearerToken) {
            throw new Error('Missing Bearer token for DCR initial_access_token validation.');
          }
          await appAuthManager.verifyInitialAccessToken(bearerToken);
        }

        const legacyBody = normalizeDidcommBodyForFhirFormat(req.body || {}, req.params.format);
        const normalizedLegacyContent = normalizeLegacyPlaintextContent(legacyBody || {});
        const legacyMeta = normalizedLegacyContent?.meta || {};

        jobRequest = {
          ...req.params,
          id: '', // Will be filled later if needed, but needs to exist
          sequence: 0,
          status: 'DRAFT' as any, // TODO: fix this any
          createdAtTimestamp: Date.now(),
          content: {
            ...normalizedLegacyContent,
            meta: {
              ...legacyMeta,
              bearer: {
                token: authToken,
                jwt: { header: { alg: '', kid: '' }, payload: verifiedBearerPayload },
              },
            },
          },
          contentType: contentType,
        };
      } else {
        return sendDidcommEarlyError(
          req,
          res,
          415,
          IssueType.NotSupported,
          `Unsupported Content-Type: ${contentType}`,
        );
      }
    } catch (error: any) {
      console.error('[API] Error during request processing/decoding:', error);
      return sendDidcommEarlyError(
        req,
        res,
        401,
        IssueType.Security,
        'Failed to process secure request: ' + error.message,
      );
    }

    // --- 2. Transaction ID Validation ---
    // Ensure contentType is always present for downstream handling (e.g. worker response encryption paths).
    (jobRequest as any).contentType = (jobRequest as any).contentType || contentType;

    const thid = jobRequest.content?.thid;
    if (!thid) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        'Request body must contain a "thid" or "id" property.',
      );
    }

    // --- 3. Path and Role Validation ---
    if (section === 'registry' && tenantId !== 'host') {
      return sendDidcommEarlyError(
        req,
        res,
        403,
        IssueType.Forbidden,
        'The "registry" section is reserved for the "host" entity.',
      );
    }
    
    const vaultId = await resolveVaultId(tenantId, sector);
    const tenantServices = await tenantsCacheManager.getDidServiceConfig(vaultId);

    // A controller-authored professional Order is the deliberate split route:
    // the host owns the commercial endpoint, while the issuer tenant owns DCR
    // key custody. Historical host catalogs may predate this exact capability.
    // Every other route remains behind the persisted service policy.
    const usesHostCommercialOrderContract = isHostControllerCommercialOrderRoute(
      tenantId,
      section,
      req.params.format,
      resourceType,
      action,
    );
    const usesHostTenantLifecycleContract = isHostTenantLifecycleRoute(
      String(tenantId || ''),
      String(section || ''),
      format,
      String(resourceType || ''),
      normalizedAction,
    );
    if (!usesHostCommercialOrderContract && !usesHostTenantLifecycleContract && !isRequestValid(tenantServices, { ...req.params, action })) {
      console.error(`[API] Path/Role validation failed for ${req.originalUrl}. Tenant services found: ${!!tenantServices}.`);
      return sendDidcommEarlyError(
        req,
        res,
        404,
        IssueType.NotFound,
        'The requested tenant or endpoint path does not exist.',
      );
    }

    if (requiresActiveTenantAuthorization(tenantId, section, req.params.format, resourceType, action)) {
      const tenantConfigForAuthorization = await tenantsCacheManager.getTenant(vaultId);
      const authorizationStatus = tenantConfigForAuthorization
        ? readTenantAuthorizationStatusFromConfig(tenantConfigForAuthorization)
        : undefined;
      if (!authorizationStatus) {
        return sendDidcommEarlyError(
          req,
          res,
          404,
          IssueType.NotFound,
          'The requested tenant or endpoint path does not exist.',
        );
      }
      if (authorizationStatus !== 'active') {
        return sendDidcommEarlyError(
          req,
          res,
          403,
          IssueType.Forbidden,
          `Tenant authorization is ${authorizationStatus}.`,
        );
      }
    }

    try {
      enforceSmartScopeRouteCompatibility({
        section,
        bearerPayload: verifiedBearerPayload,
      });
    } catch (error: any) {
      return sendDidcommEarlyError(
        req,
        res,
        403,
        IssueType.Forbidden,
        error?.message || 'SMART scope is not compatible with the requested endpoint.',
      );
    }

    // --- 4. Replay Protection (best-effort) ---
    // We only enforce when both `iss` and `jti` are present. This preserves compatibility
    // with older/plaintext payloads that may omit `jti` in development flows.
    const iss = String(jobRequest.content?.iss || '').trim();
    const jti = String(jobRequest.content?.jti || '').trim();
    if (iss && jti) {
      const replayKey = `${vaultId}:${iss}:${jti}`;
      const reserved = await replayProtectionStore.reserveIfNotExists(
        replayKey,
        getReplayTtlSeconds(jobRequest.content),
      );
      if (!reserved) {
        return sendDidcommEarlyError(
          req,
          res,
          409,
          IssueType.Conflict,
          'Duplicate jti detected for this issuer (possible replay).',
          IssueLevel.Error,
        );
      }
    }

    // --- 5. Enqueue Job ---
    const jobName = createJobName(vaultId, resourceType, action);
    jobRequest.action = action; // Ensure action is part of the job request for the worker
    await queueAdapter.addJob(jobName, jobRequest);
    asyncResponseStore.set(thid, { status: 'PENDING', vaultId: vaultId });

    // --- 6. Success Response ---
    // According to FHIR Async, the Location header MUST be an absolute URL.
    const relativeUrl = `${req.originalUrl}-response`;
    const requestBaseUrl = getRequestBaseUrl(req, apiBaseUrl);
    const pollingUrl = new URL(relativeUrl, requestBaseUrl).href;
    res.location(pollingUrl);
    res.set('Retry-After', '5');
    res.status(202).send();
  });

  return router;
}
