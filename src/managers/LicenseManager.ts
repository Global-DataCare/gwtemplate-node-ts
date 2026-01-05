// src/managers/LicenseManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-sdk-client-ts/src/models/issue';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

import { getTenantVaultId } from '../utils/tenant';

/**
 * Manages the business logic for creating device activation licenses.
 * This manager is expected to be triggered by internal system events, such as a
 * webhook from a payment processor like Stripe.
 */
export class LicenseManager implements IJobProcessor {
  private vaultRepository: IVaultRepository;

  constructor(vaultRepository: IVaultRepository) {
    this.vaultRepository = vaultRepository;
  }

  /**
   * Processes an internal job to generate device licenses for a tenant.
   * @param job The job request containing details for license creation.
   * @returns A promise resolving to a response payload indicating the result.
   * @throws {ManagerError} If the input is invalid or incomplete.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
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
    if (!userClass || (userClass !== 'employee' && userClass !== 'customer')) {
      throw new ManagerError("userClass must be either 'employee' or 'customer'.", IssueType.Value);
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
    await this.vaultRepository.put(vaultId, licenseDocs, 'device-licenses');

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
}
