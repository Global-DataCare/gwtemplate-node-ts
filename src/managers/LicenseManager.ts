// src/managers/LicenseManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

import { getTenantVaultId } from '../utils/tenant';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import type { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel } from 'gdc-common-utils-ts/models/issue';
import {
  issueActivationCodeFromPool,
  materializeFreeProfessionalLicenses,
} from '../utils/license-issuance';
import { getEnvSectionId } from '../utils/section-env';
import { getPersonOccupationClaim } from '../utils/occupation';
import {
  buildLicenseSearchClaims,
  extractLicenseSearchFilters,
  extractLicenseSearchMetaClaims,
  mapLicenseCategory,
  matchesLicenseFilters,
  resolveLicenseFilterValues,
  searchLicenseDocuments,
  toFilterValues,
} from '../utils/license-search';
import {
  LICENSE_CATEGORY_INDIVIDUAL,
  LICENSE_CATEGORY_PROFESSIONAL,
  LICENSE_STATUS_ACTIVE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_TYPE_WEB,
  LICENSE_USER_CLASS_EMPLOYEE,
  LICENSE_USER_CLASS_INDIVIDUAL,
} from '../constants/domain';
import type { ITenantsManager } from './ITenantsManager';

/**
 * Manages the business logic for creating device activation licenses.
 * This manager is expected to be triggered by internal system events, such as a
 * webhook from a payment processor like Stripe.
 */
export class LicenseManager implements IJobProcessor {
  private vaultRepository: IVaultRepository;
  private kmsService?: IKmsService;
  private tenantsCacheManager?: ITenantsManager;

  constructor(vaultRepository: IVaultRepository, kmsService?: IKmsService, tenantsCacheManager?: ITenantsManager) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  /**
   * Processes an internal job to generate device licenses for a tenant.
   * @param job The job request containing details for license creation.
   * @returns A promise resolving to a response payload indicating the result.
   * @throws {ManagerError} If the input is invalid or incomplete.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const action = String(job.action || '').trim();
    if (!action) {
      throw new ManagerError('Missing action.', IssueType.Required);
    }
    if (action === '_issue') return this.issueActivationCodes(job);
    if (action === '_search') return this.searchLicenses(job);
    if (action === '_add') return this.addFreeProfessionalLicenses(job);
    // Keep legacy/internal semantics where the action might be `create`.
    const {
      targetTenantId,
      quantity,
      plan,
      userClass,
      type,
      renewalCycle,
      reactivationEnabled,
      orderId,
      userCategory,
      deviceRestrictions,
    } = job.content?.body;

    // 1. Validate input
    if (!targetTenantId) {
        throw new ManagerError('targetTenantId is a required field.', IssueType.Required);
    }
    if (!job.sector) {
      throw new ManagerError('sector is required to resolve the tenant vault.', IssueType.Required);
    }
    if (!orderId) {
      throw new ManagerError('orderId is a required field.', IssueType.Required);
    }
    if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
      throw new ManagerError('License quantity must be a positive number.', IssueType.Value);
    }
    if (!userClass || (userClass !== LICENSE_USER_CLASS_EMPLOYEE && userClass !== LICENSE_USER_CLASS_INDIVIDUAL)) {
      throw new ManagerError(
        `userClass must be either '${LICENSE_USER_CLASS_EMPLOYEE}' or '${LICENSE_USER_CLASS_INDIVIDUAL}'.`,
        IssueType.Value,
      );
    }
    if (!type || (type !== LICENSE_TYPE_MOBILE && type !== LICENSE_TYPE_WEB)) {
      throw new ManagerError(
        `type must be either '${LICENSE_TYPE_MOBILE}' or '${LICENSE_TYPE_WEB}'.`,
        IssueType.Value,
      );
    }
    if (userClass === LICENSE_USER_CLASS_EMPLOYEE && (typeof userCategory !== 'string' || !userCategory)) {
      throw new ManagerError("A non-empty 'userCategory' is required for employee licenses.", IssueType.Value);
    }

    // 2. Determine Expiration
    const nowTimestamp = Date.now();
    const expiryDate = new Date(nowTimestamp);
    // This logic can be expanded based on the `renewalCycle` or `plan`
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const exp = Math.floor(expiryDate.getTime() / 1000);

    // 3. Generate License Documents
    const licenseDocs: ConfidentialStorageDoc[] = [];
    for (let i = 0; i < quantity; i++) {
      const licenseId = uuidv4();
      
      const license: DeviceLicense = {
        id: licenseId,
        tenantId: targetTenantId,
        orderId: orderId,
        userClass: userClass,
        userCategory: userClass === LICENSE_USER_CLASS_EMPLOYEE ? userCategory : undefined,
        type: type,
        status: LICENSE_STATUS_AVAILABLE,
        plan: plan || 'default',
        renewalCycle: renewalCycle || null,
        reactivationEnabled: reactivationEnabled === true, // Default to false
        exp: exp,
        deviceRestrictions: deviceRestrictions,
      };

      const doc: ConfidentialStorageDoc = {
        id: licenseId,
        status: license.status,
        sequence: 0,
        content: license,
      };
      licenseDocs.push(doc);
    }

    // 4. Persist to the repository
    const vaultId = getTenantVaultId(job.sector, targetTenantId);
    await this.vaultRepository.put(vaultId, licenseDocs, getEnvSectionId('device-licenses'));

    // 5. Return success response
    const responseThid = job.content?.thid as string;
    return {
      jti: uuidv4(),
      thid: responseThid,
      type: 'https://didcomm.org/securit-device-licensing/1.0/generation-response',
      iss: 'did:web:host', // Internal process issuer
      aud: 'internal', // Internal process audience
      exp: Math.floor(Date.now() / 1000) + 60,
      body: {
        type: 'transaction-response',
        total: quantity,
        data: [{
          type: 'LicenseGenerationResult',
          response: { status: '201' }, // 201 Created
          resource: {
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'information',
              code: 'informational',
              diagnostics: `${quantity} licenses of class '${userClass}'${userClass === LICENSE_USER_CLASS_EMPLOYEE ? ` and category '${userCategory}'` : ''} of type '${type}' created successfully for tenant '${targetTenantId}'.`,
            }]
          }
        }]
      }
    };
  }

  /**
   * Adds available professional seats for an explicit zero-price Test Network
   * simulation. This is not a production payment shortcut and never assigns
   * or replaces a representative, controller or member.
   */
  private async addFreeProfessionalLicenses(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    if (!(await this.tenantExists(tenantVaultId))) {
      throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
    }
    const body = job.content?.body as any;
    const entries: any[] = (Array.isArray(body?.data) && body.data)
      || (Array.isArray(body?.entry) && body.entry)
      || [];
    const responseEntries: any[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.meta?.claims as Record<string, unknown> | undefined;
      try {
        if (!rawClaims) throw new ManagerError('Missing meta.claims for License/_add entry.', IssueType.Required);
        const claims = normalizeContextualizedClaims(rawClaims);
        const category = getClaimValue<string>(claims, 'org.schema.IndividualProduct.category');
        const quantity = Number(getClaimValue<unknown>(claims, 'org.schema.Offer.eligibleQuantity.value'));
        const price = Number(getClaimValue<unknown>(claims, 'org.schema.Offer.price'));
        if (category !== LICENSE_CATEGORY_PROFESSIONAL) {
          throw new ManagerError('Professional License/_add requires professional category.', IssueType.Invalid);
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new ManagerError('License/_add quantity must be a positive integer.', IssueType.Value);
        }
        if (price !== 0) throw new ManagerError('License/_add requires an explicit zero price.', IssueType.Value);
        const networkMode = String(process.env.NETWORK_MODE || '').trim();
        const deploymentEnvironment = String(process.env.DEPLOYMENT_ENV || '').trim().toLowerCase();
        if (!['test', 'local-network', 'test-network'].includes(networkMode)
          || ['prod', 'production'].includes(deploymentEnvironment)) {
          throw new ManagerError(
            'Zero-cost professional License/_add is restricted to non-production test, local-network, or test-network.',
            IssueType.Forbidden,
          );
        }
        const documents = await materializeFreeProfessionalLicenses({
          vaultRepository: this.vaultRepository,
          tenantVaultId,
          tenantId: job.tenantId,
          quantity,
        });
        responseEntries.push({
          type: 'License:Added',
          response: { status: '201' },
          meta: { claims: rawClaims },
          resource: {
            resourceType: 'Bundle',
            type: 'collection',
            total: documents.length,
            entry: documents.map((doc) => ({ resource: { resourceType: 'Device', id: doc.id } })),
          },
        });
      } catch (error: any) {
        const managerError = error instanceof ManagerError ? error : undefined;
        responseEntries.push({
          type: 'License:Added',
          meta: { claims: rawClaims || {} },
          response: {
            status: managerError?.status || '400',
            outcome: createOperationOutcome(
              IssueLevel.Error,
              managerError?.code || IssueType.Invalid,
              error?.message || String(error),
            ),
          },
        });
      }
    }

    return {
      jti: uuidv4(),
      iss: String(job.requestUrl || ''),
      aud: String(job.tenantId),
      thid: job.id,
      type: 'https://didcomm.org/license-management/1.0/add-response',
      body: { resourceType: 'Bundle', type: 'batch-response', data: responseEntries },
    };
  }

  /**
   * Searches one tenant `device-licenses` pool using either:
   * - FHIR-like `Bundle.entry.request.url + Parameters`
   * - current shared claims-first search entries emitted by common-utils
   */
  private async searchLicenses(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = String(job.content?.thid || uuidv4());
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const body = job.content?.body as any;
    const entries: any[] =
      (Array.isArray(body?.entry) && body.entry)
      || (Array.isArray(body?.data) && body.data)
      || [];

    if (entries.length === 0) {
      throw new ManagerError('License search requires at least one entry.', IssueType.Required);
    }

    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    for (const entry of entries) {
      try {
        const filters = extractLicenseSearchFilters(entry);
        const matches = await searchLicenseDocuments(this.vaultRepository, tenantVaultId, filters);
        responseEntries.push({
          type: 'License-search-response-v1.0',
          resource: {
            total: matches.length,
            data: matches,
          } as any,
          response: { status: '200' },
        });
      } catch (e: any) {
        responseEntries.push({
          type: 'License-search-response-v1.0',
          meta: { claims: extractLicenseSearchMetaClaims(entry) },
          response: {
            status: '400',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, e?.message || String(e)),
          },
        } as any);
      }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      total: responseEntries.length,
      data: responseEntries,
    };

    return {
      jti: uuidv4(),
      thid,
      type: 'search-response',
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }

  /**
   * Issues (reserves) an activation code from the tenant's pool of `device-licenses`.
   *
   * This is a tenant-admin/IT operation used to invite a professional after licenses were purchased.
   * It converts a `DeviceLicense` from `available` -> `issued` and attaches the
   * seat credential used for its bounded set of device installations.
   *
   * Input: accept both JSON:API (`body.data[]`) and FHIR-like (`body.entry[]`) envelopes,
   * reading `entry.meta.claims`.
   */
  private async issueActivationCodes(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid || uuidv4();
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(job.sector as any, job.tenantId);
    if (!(await this.tenantExists(tenantVaultId))) {
      throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
    }

    const body = job.content?.body as any;
    const entries: any[] = (Array.isArray(body?.data) && body.data) || (Array.isArray(body?.entry) && body.entry) || [];
    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    for (const entry of entries) {
      const rawClaims =
        (entry?.meta?.claims as Record<string, any> | undefined) ??
        (entry?.resource?.meta?.claims as Record<string, any> | undefined);

      try {
        if (!rawClaims || typeof rawClaims !== 'object') throw new Error('Missing meta.claims for License/_issue entry.');
        const claims = normalizeContextualizedClaims(rawClaims);

        const category =
          getClaimValue<string>(claims, 'org.schema.IndividualProduct.category') ||
          getClaimValue<string>(claims, 'License.userClass') ||
          LICENSE_CATEGORY_PROFESSIONAL;
        const licenseUserClass =
          category === LICENSE_CATEGORY_INDIVIDUAL
            ? LICENSE_USER_CLASS_INDIVIDUAL
            : category === LICENSE_CATEGORY_PROFESSIONAL
              ? LICENSE_USER_CLASS_EMPLOYEE
              : LICENSE_USER_CLASS_EMPLOYEE;

        const licenseType =
          getClaimValue<string>(claims, 'org.schema.IndividualProduct.additionalType') ||
          getClaimValue<string>(claims, 'License.type') ||
          LICENSE_TYPE_MOBILE;
        const inviteEmail =
          getClaimValue<string>(claims, 'org.schema.Person.email') ||
          getClaimValue<string>(claims, 'License.email');
        const inviteRole =
          getPersonOccupationClaim(claims as Record<string, any>) ||
          getClaimValue<string>(claims, 'License.role');

        if (!inviteEmail) throw new Error('Missing required claim: org.schema.Person.email');
        if (!inviteRole) throw new Error('Missing required claim: org.schema.Person.hasOccupation');

        const { activationCode } = await issueActivationCodeFromPool({
          vaultRepository: this.vaultRepository,
          kmsService: this.kmsService,
          tenantVaultId,
          userClass: licenseUserClass as any,
          type: licenseType as any,
          email: inviteEmail,
          role: inviteRole,
        });

        const issuedCategory =
          licenseUserClass === LICENSE_USER_CLASS_INDIVIDUAL
            ? LICENSE_CATEGORY_INDIVIDUAL
            : licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE
              ? LICENSE_CATEGORY_PROFESSIONAL
              : 'device';
        const responseClaims = {
          ...(rawClaims as any),
          'org.schema.IndividualProduct.serialNumber': activationCode,
          'org.schema.IndividualProduct.category': issuedCategory,
        };

        responseEntries.push({
          type: 'License:Issued',
          response: { status: '201' },
          meta: { claims: responseClaims },
          resource: {
            resourceType: 'OperationOutcome',
            issue: [
              {
                severity: 'information',
                code: 'informational',
                diagnostics: 'License activation code issued.',
              },
            ],
          },
          // Expose activationCode explicitly so the admin can copy/paste (email/QR is out of scope for now).
          ...(activationCode ? { id: activationCode } : {}),
        } as any);
      } catch (e: any) {
        responseEntries.push({
          type: 'License:Issued',
          meta: { claims: rawClaims || {} },
          response: {
            status: '400',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, e?.message || String(e)),
          },
        } as any);
      }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      data: responseEntries,
    };

    return {
      jti: uuidv4(),
      thid: String(thid),
      type: 'transaction-response',
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }

  /**
   * Accepts both FHIR-style request wrappers and shared claims-first search
   * entries so the GW route can serve current SDK/common-utils helpers.
   */
  private extractLicenseSearchFilters(entry: any): ReturnType<typeof extractLicenseSearchFilters> {
    return extractLicenseSearchFilters(entry);
  }

  /**
   * Extracts the original search claims for error reporting without assuming
   * whether they arrived in `entry.meta.claims` or `entry.resource.meta.claims`.
   */
  private extractLicenseSearchMetaClaims(entry: any): Record<string, unknown> {
    return extractLicenseSearchMetaClaims(entry);
  }

  /**
   * Returns one frontend-friendly search row shape compatible with the shared
   * `readLicenseListRecords(...)` reader.
   */
  private async searchLicenseDocuments(
    tenantVaultId: string,
    filters: ReturnType<typeof extractLicenseSearchFilters>,
  ): Promise<Array<Record<string, unknown>>> {
    return searchLicenseDocuments(this.vaultRepository, tenantVaultId, filters);
  }

  /**
   * Projects one stored `DeviceLicense` document into the shared
   * schema.org-flavored claim shape expected by list/search readers.
   */
  private buildLicenseSearchClaims(license: DeviceLicense & Record<string, any>): Record<string, unknown> {
    return buildLicenseSearchClaims(license);
  }

  /**
   * Applies all requested search filters to one stored seat.
   */
  private matchesLicenseFilters(
    license: (DeviceLicense & Record<string, any>) | undefined,
    filters: ReturnType<typeof extractLicenseSearchFilters>,
  ): boolean {
    return matchesLicenseFilters(license, filters);
  }

  /**
   * Resolves one concrete filter key into the comparable string values exposed
   * by the current storage model.
   */
  private resolveLicenseFilterValues(
    license: DeviceLicense & Record<string, any>,
    key: string,
  ): string[] {
    return resolveLicenseFilterValues(license, key);
  }

  /**
   * Maps runtime user-class storage to the schema.org-style license family
   * value already used by shared readers/builders.
   */
  private mapLicenseCategory(userClass: string | undefined): string {
    return mapLicenseCategory(userClass);
  }

  /**
   * Normalizes one optional scalar into the common string-array form used by
   * the search matcher.
   */
  private toFilterValues(value: unknown): string[] {
    return toFilterValues(value);
  }
}
