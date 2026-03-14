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
import { issueActivationCodeFromPool } from '../utils/license-issuance';
import { getEnvSectionId } from '../utils/section-env';

/**
 * Manages the business logic for creating device activation licenses.
 * This manager is expected to be triggered by internal system events, such as a
 * webhook from a payment processor like Stripe.
 */
export class LicenseManager implements IJobProcessor {
  private vaultRepository: IVaultRepository;
  private kmsService?: IKmsService;

  constructor(vaultRepository: IVaultRepository, kmsService?: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
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
    if (!orderId) {
      throw new ManagerError('orderId is a required field.', IssueType.Required);
    }
    if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
      throw new ManagerError('License quantity must be a positive number.', IssueType.Value);
    }
    if (!userClass || (userClass !== 'employee' && userClass !== 'individual')) {
      throw new ManagerError("userClass must be either 'employee' or 'individual'.", IssueType.Value);
    }
    if (!type || (type !== 'mobile' && type !== 'web')) {
      throw new ManagerError("type must be either 'mobile' or 'web'.", IssueType.Value);
    }
    if (userClass === 'employee' && (typeof userCategory !== 'string' || !userCategory)) {
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
        userCategory: userClass === 'employee' ? userCategory : undefined,
        type: type,
        status: 'available',
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
    const vaultId = getTenantVaultId('health-care', targetTenantId); // Assume sector for now
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
              diagnostics: `${quantity} licenses of class '${userClass}'${userClass === 'employee' ? ` and category '${userCategory}'` : ''} of type '${type}' created successfully for tenant '${targetTenantId}'.`,
            }]
          }
        }]
      }
    };
  }

  /**
   * Issues (reserves) an activation code from the tenant's pool of `device-licenses`.
   *
   * This is a tenant-admin/IT operation used to invite a professional after licenses were purchased.
   * It converts a single `DeviceLicense` from `available` -> `issued` and attaches an `activationCode`.
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
    if (!(await this.vaultRepository.vaultExists(tenantVaultId))) {
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
          'professional';
        const licenseUserClass =
          category === 'individual' ? 'individual' : category === 'professional' ? 'employee' : 'employee';

        const licenseType =
          getClaimValue<string>(claims, 'org.schema.IndividualProduct.additionalType') ||
          getClaimValue<string>(claims, 'License.type') ||
          'mobile';
        const inviteEmail =
          getClaimValue<string>(claims, 'org.schema.Person.email') ||
          getClaimValue<string>(claims, 'License.email');
        const inviteRole =
          getClaimValue<string>(claims, 'org.schema.Person.hasOccupation') ||
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
          licenseUserClass === 'individual' ? 'individual' : licenseUserClass === 'employee' ? 'professional' : 'device';
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
}
