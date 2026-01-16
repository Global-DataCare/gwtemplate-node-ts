// File: src/managers/PingManager.ts

import { v4 as uuidv4 } from 'uuid';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { BundleJsonApi, BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { TenantsCacheManager } from './TenantsCacheManager';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';

/**
 * Manages the business logic for the 'ping' operation.
 * Its sole purpose is to echo back the received entries with a success status,
 * serving as a reference implementation and end-to-end diagnostic tool.
 */
export class PingManager {
  private tenantsCacheManager: TenantsCacheManager;

  constructor(tenantsCacheManager: TenantsCacheManager) {
    this.tenantsCacheManager = tenantsCacheManager;
  }

  /**
   * Processes a ping job by echoing the input entries back in the response.
   * @param job The job object containing the ping request data.
   * @returns A IDecodedDidcommPayload object with the echoed entries.
   */
  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const jobEntries = job?.content?.body?.data || [];

    // Create response entries by appending a success status to each original entry.
    const responseEntries: BundleEntry[] = jobEntries.map((entry: BundleEntry) => ({
      ...entry,
      response: {
        status: '200',
      },
    }));

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: 'Bundle',
      total: responseEntries.length,
      type: getBundleResponseTypeForAction(job.action),
    };

    // Determine the issuer's DID from the cache based on the tenantId from the job.
    const vaultId = job.tenantId || 'host';
    const issuerDid = await this.tenantsCacheManager.getTenantDid(vaultId);

    if (!issuerDid) {
      // This should theoretically never happen if the routing validation is working correctly.
      throw new ManagerError(`Could not determine issuer DID for vaultId: ${vaultId}`, IssueType.NotFound);
    }

    // Construct the final JARM-compliant response payload.
    return {
      jti: uuidv4(),
      type: 'ping-response',
      thid: job.content?.thid as string,
      iss: issuerDid,
      aud: job.content?.iss as string,   // The response is for the original requester
      exp: Math.floor(Date.now() / 1000) + 300, // Expires in 5 minutes
      body: responseBundle,
    };
  }
}
