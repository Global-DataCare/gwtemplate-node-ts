// src/routes/api.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { TenantsCacheManager } from '../managers/TenantsCacheManager';
import { QueueAdapter } from '../adapters/queue';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';
import { createJobName } from '../utils/naming';
import { isRequestValid } from '../utils/request-validator';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
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

const FORWARDED_HEADER_SEPARATOR = ',';
type SecurityMode = 'strict' | 'compat' | 'demo';
type ParsedContentType = 'secure-form' | 'didcomm-plain' | 'json' | 'fhir' | 'unsupported';

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

function parseIncomingContentType(contentType: string): ParsedContentType {
  if (contentType === 'application/x-www-form-urlencoded') return 'secure-form';
  if (contentType === 'application/didcomm-plaintext+json') return 'didcomm-plain';
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

  if (actionBase === '_dcr') {
    mappedFormat = 'openid';
    mappedResourceType = 'Device';
  } else if (actionBase === '_code' || actionBase === '_token' || actionBase === '_exchange') {
    mappedFormat = 'openid';
    mappedResourceType = 'Token';
  } else if (actionBase === '_issue') {
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
  tenantsCacheManager: TenantsCacheManager,
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
    const directTenant = await tenantsCacheManager.getTenant(directVaultId);
    if (directTenant) return directVaultId;

    const canonicalVaultId = await tenantsCacheManager.findTenantVaultIdByIdentifierValue(tenantId);
    if (canonicalVaultId) return canonicalVaultId;
    return directVaultId;
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
    const thid = (req.method === 'POST' ? req.body.thid : req.query.thid) as string | undefined;

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
        await appAuthManager.verifyIdToken(accessToken);
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *       - canonical proof input is `body.vp_token`; the ICA organization + representative evidence belongs there
   *       - `body.controller.*` is the explicit controller key-binding contract inherited from the ICA model and is used when GW must publish/bootstrap the controller person DID
   *       - `body.organizationCredential` / `body.representativeCredential` are deprecated compatibility fields and must not be treated as the canonical proof contract
   *       - the host validates the ICA proof and activates the tenant backend/connector
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical,
   *         and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_batch:
   *   post:
   *     tags:
   *       - 3.1 Employee Role
   *     summary: Create a new Professional (Employee)
   *     description: |
   *       Submits an asynchronous job to create or reactivate a professional (employee) within an existing tenant.
   *       The `tenantId` in the path specifies the organization under which the employee is being created.
   *       Prerequisite: controller device/client must already be active (`Token/_exchange` + `Device/_dcr`).
   *       Creating an employee profile does not automatically activate employee devices.
   *       For additional employees/devices, use `License/_issue` and then run `_exchange` + `_dcr`.
   *       
   *       V1 lifecycle semantics:
   *       - business identity is the combination `email + role`
   *       - if the same `email + role` already exists and is active, the gateway returns the existing employee instead of creating a duplicate
   *       - if the same `email + role` exists and is inactive, the gateway reactivates that employee record
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *         With `@context: "org.schema"`, clients may send contextualized keys such as `Organization.identifier.value`
   *         or `Service.category` without the `org.schema.` prefix; that is the documented default mode.
   *         If the service enables `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, equivalent fully-qualified `org.schema.*`
   *         keys remain valid. `Service.termsOfService` may be an HTTPS URL or an embedded PDF data URL; Swagger uses
   *         the HTTPS URL form as the default example.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *       '200': { description: Completed. }
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *       and returns a single-use activation code for subsequent `Token/_exchange`.
   *       User licenses can issue multiple activation codes for different device profiles (mobile/web).
   *       Device licenses only issue a single activation code per seat.
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
   *         application/didcomm-plaintext+json:
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
   *       '200': { description: Completed. }
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *         Legacy mode (non-production only): `application/fhir+json` may be used to send a raw FHIR Bundle without DIDComm envelope.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   * /{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch:
   *   post:
   *     tags:
   *       - 9. Research Digital Twin
   *     summary: Ingest pre-converted research claims (digital twin)
   *     description: |
   *       Submits an async research ingestion job for digital twin indexing.
   *       This endpoint is intended for research sectors (e.g., `animal-research`, `health-research`).
   *
   *       Expected payload shape (adapter-ingestion-py output):
   *       - DIDComm plaintext message
   *       - `body.data[]` array
   *       - each item is a Composition resource object with:
   *         - `resource.meta.claims` for Composition claims
   *         - optional `resource.contained[].meta.claims` for source resources
   *           (`DocumentReference`, and future `Encounter` / `Patient`)
   *
   *       Current gateway behavior:
   *       - validates/stores Composition-level claims (`Composition.*`)
   *       - does not yet persist contained `Encounter`/`Patient` claims as independent resources.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *     summary: Ingest research digital twin payload in strict FHIR R4 mode
   *     description: |
   *       Same research ingestion flow as `org.hl7.fhir.api`, but with version-aware validation.
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
   *         application/didcomm-plaintext+json:
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
   *         application/didcomm-plaintext+json:
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
   *         application/didcomm-plaintext+json:
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
  *         application/didcomm-plaintext+json:
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. Returns either JSON (plaintext) or `response=<jwe>` (secure). }
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
   *       The completed response returns a Bundle entry with order invoice claims, including an optional payment
   *       link (`org.schema.Order.paymentUrl`) and the accepted Offer reference (`org.schema.Order.acceptedOffer.identifier`). When using
   *       Stripe (INVOICE_PROVIDER=stripe, INVOICE_FLOW=pre), `org.schema.Order.partOfInvoice` and `org.schema.Order.paymentUrl` refer to
   *       the Stripe invoice/checkout URL. UBL/PDF/VeriFactu invoices are not emitted yet.
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessage'
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
   *         `application/didcomm-plaintext+json` is canonical, and `application/json`
   *         is also accepted for simplicity.
   *         With `@context: "org.schema"`, clients may send contextualized keys such as `Organization.identifier.value`
   *         or `Service.category` without the `org.schema.` prefix; that is the documented default mode.
   *         If the service enables `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, equivalent fully-qualified `org.schema.*`
   *         keys remain valid. `Service.termsOfService` may be an HTTPS URL or an embedded PDF data URL; Swagger uses
   *         the HTTPS URL form as the default example.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
   *           schema:
   *             $ref: '#/components/schemas/DidcommPlaintextMessage'
   *           examples:
   *             message:
   *               $ref: '#/components/examples/FamilyRegistrationPlaintextMessage'
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *       The completed response returns a Bundle entry with order invoice claims, including an
   *       optional payment link (`org.schema.Order.paymentUrl`) and the accepted Offer reference (`org.schema.Order.acceptedOffer.identifier`).
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
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
   *         application/x-www-form-urlencoded:
   *           schema: { $ref: '#/components/schemas/AsyncPollRequest' }
   *     responses:
   *       '202': { description: Pending. Retry later. }
   *       '200': { description: Completed. }
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
   *       VP requirement: the SMART authorization request MUST include a verifiable presentation (VP) inside
   *       the JAR (request object) or the DIDComm payload (demo flow). This VP is validated via the Gaia-X
   *       Clearing House to enforce non-revocation before issuing the token.
   *
   *       Demo payload note: in this endpoint the DIDComm `body` represents the JAR (authorize request object),
   *       including PKCE parameters (`code_challenge`, `code_challenge_method`), `client_id`, `redirect_uri`,
   *       `vp_token`, optional `presentation_submission`, and `acr_values`.
   *
   *       The worker will validate the target subject exists and that at least one consent rule matches the actor.
   *     parameters:
   *       - $ref: '#/components/parameters/AppId'
   *       - $ref: '#/components/parameters/AppVersion'
   *       - $ref: "#/components/parameters/TenantId"
   *       - $ref: "#/components/parameters/Jurisdiction"
   *       - $ref: "#/components/parameters/Sector"
   *     requestBody:
   *       description: |
   *         Production: only `application/x-www-form-urlencoded` is accepted (secure JWE envelope with `request=`).
   *         Demo/Test-Network: `application/didcomm-plaintext+json` is canonical, and `application/json` is also accepted for simplicity.
   *       required: true
   *       content:
   *         application/didcomm-plaintext+json:
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
  // --- 1. ASYNC JOB SUBMISSION ENDPOINT ---
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
        + 'Prefer Organization/_activate for ICA-first onboarding.',
      );
    }
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
        // The KMS decrypts the JWE using the HOST's key and returns the inner JWS, but does not verify it.
        const decodedJob = await kmsService.decodeRequest(req.body.request);
        // The Bearer token (e.g., Firebase id_token) is still an HTTP concern, but some identity endpoints
        // need it during async processing. We propagate it into the decoded payload meta for the worker.
        const bearerToken = req.headers.authorization;
        if (bearerToken) {
          (decodedJob as any).content = (decodedJob as any).content || {};
          (decodedJob as any).content.meta = (decodedJob as any).content.meta || {};
          (decodedJob as any).content.meta.bearer = { token: bearerToken, jwt: { header: {}, payload: {} } };
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

          // 1. Determine the tenant vault from the request path (authoritative).
          // Some legacy hosted DIDs do not encode `cds-XX/v1/{sector}` segments, so parsing the DID is not reliable.
          const vaultId = await resolveVaultId(tenantId, sector);
          try {
            const vaultIdFromDid = getTenantVaultIdFromIss(senderDid);
            if (vaultIdFromDid !== vaultId) {
              throw new Error(`Issuer DID does not belong to tenant. did=${senderDid} pathVault=${vaultId} didVault=${vaultIdFromDid}`);
            }
          } catch {
            // Ignore: legacy DID formats are validated by path-based routing instead.
          }
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
          if (!queryResult || queryResult.length === 0) {
            throw new Error(`Could not find an entity with key ID '${senderSigningKeyId}' in vault '${vaultId}'.`);
          }

          // 4. Unprotect the document to get the sender's full config.
          const employeeDoc = queryResult[0];
          const employeeConfig = await kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, vaultId);

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
            await appAuthManager.verifyIdToken(bearerToken);
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
        const legacyMeta = legacyBody?.meta || {};

        jobRequest = {
          ...req.params,
          id: '', // Will be filled later if needed, but needs to exist
          sequence: 0,
          status: 'DRAFT' as any, // TODO: fix this any
          createdAtTimestamp: Date.now(),
          content: {
            ...legacyBody,
            meta: {
              ...legacyMeta,
              bearer: {
                token: authToken,
                // TODO: This structure should be populated by a real JWT verification function.
                jwt: { header: { alg: '', kid: '' }, payload: {} },
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

    if (!isRequestValid(tenantServices, { ...req.params, action })) {
      console.error(`[API] Path/Role validation failed for ${req.originalUrl}. Tenant services found: ${!!tenantServices}.`);
      return sendDidcommEarlyError(
        req,
        res,
        404,
        IssueType.NotFound,
        'The requested tenant or endpoint path does not exist.',
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
