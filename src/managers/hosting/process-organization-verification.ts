import { v4 as uuidv4 } from 'uuid';
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { DidCommDecodedMetadata, IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsPersonSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { getBundleResponseTypeForAction } from '../../utils/bundle';
import { normalizeContextualizedClaims } from '../../utils/claims';
import { validateNewOrganizationClaims } from '../../utils/claims-validator';
import { determineResourceId } from '../../utils/resource';
import { getTenantVaultId, isValidTenantAlternateName } from '../../utils/tenant';
import { createOrganizationUrn } from '../../utils/urn';
import { issueActivationCodeFromPool } from '../../utils/license-issuance';
import { getPersonOccupationClaim } from '../../utils/occupation';
import { normalizeIndexedEmail } from '../../utils/indexed-contact';
import {
  HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS,
  HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS,
} from './hosting-claim-contracts';

type LegalOrganizationVerificationTransactionResource = Readonly<{
  controller?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  legalRepresentativePayload?: Record<string, unknown>;
  legalRepresentative?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}>;

type LegalOrganizationVerificationTransactionEntry = Readonly<{
  type?: string;
  meta?: {
    claims?: ClaimsRecord;
  };
  resource?: LegalOrganizationVerificationTransactionResource;
}>;

type LegalOrganizationVerificationTransactionNextStep = Readonly<{
  action: 'Order/_batch';
  acceptedOffer: {
    identifier?: string;
    identifierClaim: typeof ClaimsOrderSchemaorg.acceptedOfferIdentifier;
  };
}>;

type LegalOrganizationVerificationTransactionResponseResource = Readonly<{
  icaResponse: unknown;
  next: LegalOrganizationVerificationTransactionNextStep;
}>;

type LegalOrganizationIssueResponseResource = Readonly<{
  icaResponse: unknown;
}>;

export const ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE_TYPE = 'Organization-verification-transaction-response-v1.0';
export const ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST_TYPE = 'Organization-verification-transaction-request-v1.0';
export const ORGANIZATION_VERIFICATION_TRANSACTION_NEXT_ACTION = 'Order/_batch';
export const ORGANIZATION_ISSUE_RESPONSE_TYPE = 'Organization-issue-response-v1.0';

type VerificationDeps = Readonly<{
  job: JobRequest;
  issuerDid: string;
  config: { sectorsAllowed: Sector[]; namespace: string; securityMode?: string };
  normalizeClaims: (claims: ClaimsRecord) => ClaimsRecord;
  createPendingTenantRegistrationFromClaims: (input: {
    claims: ClaimsRecord;
    environment?: string;
    jobMeta?: DidCommDecodedMetadata;
    fallbackAlternateName?: string;
    primaryDid?: string;
  }) => Promise<ClaimsRecord>;
  createOrganizationIssueClaimsFromClaims: (input: {
    claims: ClaimsRecord;
    environment?: string;
    fallbackAlternateName?: string;
    bearerPayload?: Record<string, any>;
  }) => Promise<ClaimsRecord>;
  forwardOrganizationVerificationTransactionToIca: (input: {
    job: JobRequest;
    entry: LegalOrganizationVerificationTransactionEntry;
    claims: ClaimsRecord;
    resource: LegalOrganizationVerificationTransactionResource;
    requestedSector: string;
    resourceType: string;
  }) => Promise<any>;
  extractCredentialResourcesFromIcaPayload: (icaResponse: unknown) => Array<Record<string, unknown>>;
}>;

export async function processOrganizationVerificationTransaction(
  deps: VerificationDeps,
): Promise<IDecodedDidcommPayload> {
  /**
   * Contract for first-time legal-organization onboarding:
   * - `_transaction` must return the canonical commercial Offer in
   *   `meta.claims['org.schema.Offer.identifier']`
   * - the same value is mirrored in `resource.next.acceptedOffer.identifier`
   *   only as a workflow hint for `Order/_batch`
   * - follow-up commercial confirmation is mandatory and consumes
   *   `Order.acceptedOffer.identifier`
   *
   * Existing-tenant controller reissue is intentionally not handled here.
   * That contract belongs to `_issue`, which reuses the tenant and controller
   * seat without creating a new commercial Offer.
   */
  const entry = (deps.job.content?.body?.data?.[0] || {}) as LegalOrganizationVerificationTransactionEntry;
  const claims = normalizeContextualizedClaims(entry.meta?.claims || {});
  const resource = (entry.resource || {}) as LegalOrganizationVerificationTransactionResource;
  const requestedSector = String(claims[ClaimsServiceSchemaorg.category] || '').trim();
  const resourceType = String(resource.verification?.resourceType || 'contract').trim() || 'contract';
  if (!requestedSector) {
    throw new ManagerError(`Missing required claim: '${HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS[1]}'`, IssueType.Required);
  }

  const icaResponse = await deps.forwardOrganizationVerificationTransactionToIca({
    job: deps.job,
    entry,
    claims,
    resource,
    requestedSector,
    resourceType,
  });
  const vc = deps.extractCredentialResourcesFromIcaPayload(icaResponse);
  const requestedPrimaryDid = typeof resource.organization?.did === 'string'
    ? resource.organization.did.trim()
    : '';
  if (requestedPrimaryDid && !/^did:[a-z0-9]+:.+$/i.test(requestedPrimaryDid)) {
    throw new ManagerError('Organization verification organization.did must be a valid DID.', IssueType.Value);
  }
  const processedClaims = await deps.createPendingTenantRegistrationFromClaims({
    claims,
    environment: resourceType,
    jobMeta: deps.job.content?.meta,
    fallbackAlternateName: deps.job.tenantId,
    primaryDid: requestedPrimaryDid || undefined,
  });

  return {
    jti: uuidv4(),
    type: 'hosting-response',
    thid: deps.job.content?.thid as string,
    iss: deps.issuerDid,
    aud: deps.job.content?.iss as string,
    body: {
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(deps.job.action),
      total: 1,
      data: [{
        type: ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE_TYPE,
        ...(vc.length > 0 ? { vc } : {}),
        meta: { claims: processedClaims },
        resource: buildOrganizationVerificationTransactionResponseResource(icaResponse, processedClaims),
        response: { status: '200' },
      }],
    },
  };
}

export async function processOrganizationIssue(
  deps: VerificationDeps,
): Promise<IDecodedDidcommPayload> {
  /**
   * Contract for existing-tenant legal-organization reissue:
   * - `_issue` may re-emit controller activation material for the already
   *   existing tenant
   * - `_issue` must not mint a new commercial Offer when seats and order terms
   *   stay unchanged
   * - callers must therefore not expect
   *   `meta.claims['org.schema.Offer.identifier']` nor a `resource.next`
   *   commercial step in this response
   */
  const entry = (deps.job.content?.body?.data?.[0] || {}) as LegalOrganizationVerificationTransactionEntry;
  const claims = normalizeContextualizedClaims(entry.meta?.claims || {});
  const resource = (entry.resource || {}) as LegalOrganizationVerificationTransactionResource;
  const requestedSector = String(claims[ClaimsServiceSchemaorg.category] || '').trim();
  const resourceType = String(resource.verification?.resourceType || 'contract').trim() || 'contract';
  if (!requestedSector) {
    throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
  }

  const icaResponse = await deps.forwardOrganizationVerificationTransactionToIca({
    job: deps.job,
    entry,
    claims,
    resource,
    requestedSector,
    resourceType,
  });
  const vc = deps.extractCredentialResourcesFromIcaPayload(icaResponse);
  const processedClaims = await deps.createOrganizationIssueClaimsFromClaims({
    claims,
    environment: resourceType,
    fallbackAlternateName: deps.job.tenantId,
    bearerPayload: (deps.job.content as any)?.meta?.bearer?.jwt?.payload,
  });

  return {
    jti: uuidv4(),
    type: 'hosting-response',
    thid: deps.job.content?.thid as string,
    iss: deps.issuerDid,
    aud: deps.job.content?.iss as string,
    body: {
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(deps.job.action),
      total: 1,
      data: [{
        type: ORGANIZATION_ISSUE_RESPONSE_TYPE,
        ...(vc.length > 0 ? { vc } : {}),
        meta: { claims: processedClaims },
        resource: buildOrganizationIssueResponseResource(icaResponse),
        response: { status: '200' },
      }],
    },
  };
}

export function buildOrganizationVerificationTransactionResponseResource(
  icaResponse: unknown,
  processedClaims: ClaimsRecord,
): LegalOrganizationVerificationTransactionResponseResource {
  const offerId = String(processedClaims[HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS[0]] || '').trim() || undefined;
  return {
    icaResponse,
    next: {
      action: ORGANIZATION_VERIFICATION_TRANSACTION_NEXT_ACTION,
      acceptedOffer: {
        ...(offerId ? { identifier: offerId } : {}),
        identifierClaim: ClaimsOrderSchemaorg.acceptedOfferIdentifier,
      },
    },
  };
}

export function buildOrganizationIssueResponseResource(
  icaResponse: unknown,
): LegalOrganizationIssueResponseResource {
  return { icaResponse };
}

type IssueClaimsDeps = Readonly<{
  claims: ClaimsRecord;
  environment?: string;
  fallbackAlternateName?: string;
  bearerPayload?: Record<string, any>;
  config: { namespace: string; sectorsAllowed: Sector[]; securityMode?: string };
  vaultRepository: {
    vaultExists(id: string): Promise<boolean>;
    getContainersInSection(vaultId: string, sectionId: string): Promise<any[]>;
  };
  kmsService: {
    unprotectConfidentialData?<T = any>(doc: ConfidentialStorageDoc, entityId: string): Promise<T>;
  };
  getEnvSectionId: (section: string) => string;
  applyLegalOrganizationIdentityCompatibility: (claims: ClaimsRecord) => ClaimsRecord;
  extractResources: (claims: ClaimsRecord, environment?: string) => { organization: any; service: any };
  handleServiceAttachment: (service: any) => Promise<any>;
  getCurrentUrnNetwork: () => string;
}>;

export async function createOrganizationIssueClaims(
  deps: IssueClaimsDeps,
): Promise<ClaimsRecord> {
  const normalizedClaims = deps.applyLegalOrganizationIdentityCompatibility(deps.claims);
  const alternateName = String(
    normalizedClaims[ClaimsOrganizationSchemaorg.alternateName]
    || deps.fallbackAlternateName
    || '',
  ).trim();
  const enrichedClaims: ClaimsRecord = {
    ...normalizedClaims,
    ...(alternateName ? { [ClaimsOrganizationSchemaorg.alternateName]: alternateName } : {}),
  };
  validateNewOrganizationClaims(enrichedClaims);

  if (!alternateName) {
    throw new ManagerError(`Missing required claim: '${ClaimsOrganizationSchemaorg.alternateName}'`, IssueType.Required);
  }
  if (!isValidTenantAlternateName(alternateName)) {
    throw new ManagerError(`Invalid alternateName format: '${alternateName}'`, IssueType.Value);
  }

  const requestedSector = enrichedClaims[ClaimsServiceSchemaorg.category] as Sector;
  if (!requestedSector) {
    throw new ManagerError(`Missing required claim for existing tenant: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
  }
  if (requestedSector === 'system') {
    throw new ManagerError("The 'system' sector is a reserved keyword and cannot be used by tenants.", IssueType.Forbidden);
  }
  if (!deps.config.sectorsAllowed.includes(requestedSector)) {
    throw new ManagerError(`The requested sector '${requestedSector}' is not supported by this gateway.`, IssueType.Value);
  }

  const vaultId = getTenantVaultId(requestedSector, alternateName);
  if (!await deps.vaultRepository.vaultExists(vaultId)) {
    throw new ManagerError(`Tenant not found for Organization/_issue: '${vaultId}'`, IssueType.NotFound);
  }

  const controllerIdentity = await resolveOrganizationIssueControllerIdentity({
    claims: enrichedClaims,
    bearerPayload: deps.bearerPayload,
    tenantVaultId: vaultId,
    securityMode: deps.config.securityMode,
    findStoredControllerRoleByEmail: async (tenantVaultId, email) => findStoredControllerRoleByEmail({
      tenantVaultId,
      email,
      vaultRepository: deps.vaultRepository,
      kmsService: deps.kmsService,
      getEnvSectionId: deps.getEnvSectionId,
    }),
  });
  const claimsForValidation: ClaimsRecord = {
    ...enrichedClaims,
    ...(controllerIdentity.email && !enrichedClaims[ClaimsPersonSchemaorg.email]
      ? { [ClaimsPersonSchemaorg.email]: controllerIdentity.email }
      : {}),
    ...(controllerIdentity.role && !getPersonOccupationClaim(enrichedClaims as Record<string, any> | undefined)
      ? { [ClaimsPersonSchemaorg.hasOccupation]: controllerIdentity.role }
      : {}),
  };
  validateNewOrganizationClaims(claimsForValidation);

  const { organization, service } = deps.extractResources(claimsForValidation, deps.environment);
  const processedService = await deps.handleServiceAttachment(service);
  let processedClaims: ClaimsRecord = { ...claimsForValidation, ...(processedService?.meta?.claims || {}) };

  const jurisdiction = processedClaims[ClaimsOrganizationSchemaorg.addressCountry] as string;
  const isIndividualOrg = !!processedClaims['org.schema.Organization.owner.telephone'];
  if (!processedClaims[ClaimsOrganizationSchemaorg.identifier]) {
    if (!isIndividualOrg) {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = createOrganizationUrn({
        namespace: deps.config.namespace,
        network: deps.getCurrentUrnNetwork(),
        jurisdiction,
        sector: requestedSector,
        idType: processedClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
        idValue: processedClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
      });
    } else {
      (processedClaims as any)[ClaimsOrganizationSchemaorg.identifier] = alternateName || determineResourceId(organization.id, deps.environment);
    }
  }

  const { email: legalRepEmail, role: legalRepRole } = await resolveOrganizationIssueControllerIdentity({
    claims: processedClaims,
    bearerPayload: deps.bearerPayload,
    tenantVaultId: vaultId,
    securityMode: deps.config.securityMode,
    findStoredControllerRoleByEmail: async (tenantVaultId, email) => findStoredControllerRoleByEmail({
      tenantVaultId,
      email,
      vaultRepository: deps.vaultRepository,
      kmsService: deps.kmsService,
      getEnvSectionId: deps.getEnvSectionId,
    }),
  });
  if (!legalRepEmail) {
    throw new ManagerError(`Missing required claim for Organization/_issue: '${ClaimsPersonSchemaorg.email}'`, IssueType.Required);
  }
  if (!legalRepRole) {
    throw new ManagerError('Missing required controller occupation claim for Organization/_issue.', IssueType.Required);
  }

  try {
    const { activationCode } = await issueActivationCodeFromPool({
      vaultRepository: deps.vaultRepository as any,
      kmsService: deps.kmsService as any,
      tenantVaultId: vaultId,
      userClass: 'employee',
      type: 'mobile',
      email: legalRepEmail,
      role: legalRepRole,
    });
    (processedClaims as any)['org.schema.IndividualProduct.serialNumber'] = activationCode;
    (processedClaims as any)['org.schema.IndividualProduct.category'] = 'professional';
  } catch (error: any) {
    throw new ManagerError(
      `Unable to issue a controller activation code for existing tenant '${vaultId}': ${String(error?.message || error)}`,
      IssueType.Conflict,
    );
  }

  return processedClaims;
}

async function resolveOrganizationIssueControllerIdentity(input: {
  claims: ClaimsRecord;
  bearerPayload?: Record<string, any>;
  tenantVaultId: string;
  securityMode?: string;
  findStoredControllerRoleByEmail: (tenantVaultId: string, email: string | undefined) => Promise<string | undefined>;
}): Promise<{ email?: string; role?: string }> {
  const emailFromPayload = normalizeIndexedEmail(input.claims[ClaimsPersonSchemaorg.email]) as string | undefined;
  const emailFromBearer = normalizeIndexedEmail(
    (input.bearerPayload?.email as string | undefined)
    || (input.bearerPayload?.upn as string | undefined)
    || (input.bearerPayload?.preferred_username as string | undefined),
  ) as string | undefined;
  const roleFromPayload = getPersonOccupationClaim(input.claims as Record<string, any> | undefined);
  const isDemoMode = input.securityMode === 'demo';

  const email = isDemoMode ? (emailFromPayload || emailFromBearer) : emailFromBearer;
  let role = roleFromPayload || await input.findStoredControllerRoleByEmail(input.tenantVaultId, email);
  if (isDemoMode && !role) {
    role = 'ISCO-08|1120';
    console.log('[GW][demo] Organization/_issue controller role fallback applied', {
      tenantVaultId: input.tenantVaultId,
      email,
      role,
    });
  }
  if (isDemoMode) {
    console.log('[GW][demo] Organization/_issue controller identity resolved', {
      tenantVaultId: input.tenantVaultId,
      email,
      role,
      usedBearerEmail: email === emailFromBearer && !!emailFromBearer,
      usedPayloadEmail: email === emailFromPayload && !!emailFromPayload,
    });
  }
  return { email, role };
}

async function findStoredControllerRoleByEmail(input: {
  tenantVaultId: string;
  email: string | undefined;
  vaultRepository: {
    getContainersInSection(vaultId: string, sectionId: string): Promise<any[]>;
  };
  kmsService: {
    unprotectConfidentialData?<T = any>(doc: ConfidentialStorageDoc, entityId: string): Promise<T>;
  };
  getEnvSectionId: (section: string) => string;
}): Promise<string | undefined> {
  const normalizedEmail = normalizeIndexedEmail(input.email) as string | undefined;
  if (!normalizedEmail) return undefined;

  const employeeDocs = await input.vaultRepository.getContainersInSection(
    input.tenantVaultId,
    input.getEnvSectionId('employees'),
  ) as ConfidentialStorageDoc[];
  for (const employeeDoc of employeeDocs) {
    let claims = (employeeDoc?.content as any)?.claims as Record<string, any> | undefined;
    if (!claims && typeof input.kmsService.unprotectConfidentialData === 'function') {
      try {
        const unprotected = await input.kmsService.unprotectConfidentialData(employeeDoc, input.tenantVaultId);
        claims = (unprotected as any)?.claims as Record<string, any> | undefined;
      } catch {
        claims = claims || undefined;
      }
    }
    const storedEmail = normalizeIndexedEmail(claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
    if (!storedEmail || storedEmail !== normalizedEmail) continue;
    const storedRole = getPersonOccupationClaim(claims);
    if (storedRole) return storedRole;
  }
  return undefined;
}
