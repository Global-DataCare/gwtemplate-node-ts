// File: src/managers/PingManager.ts

import { JobRequest } from '../models/request';
import { IPayloadResponse } from '../models/response';
import { Bundle, BundleEntry } from '../models/bundle';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { getTenantDidWebId, getHostDidWebId } from '../utils/did';

/**
 * Manages the business logic for the 'ping' operation.
 * Its sole purpose is to echo back the received entries with a success status,
 * serving as a reference implementation and end-to-end diagnostic tool.
 */
export class PingManager {

  /**
   * Processes a ping job by echoing the input entries back in the response.
   * @param job The job object containing the ping request data.
   * @returns A IPayloadResponse object with the echoed entries.
   */
  async process(job: JobRequest): Promise<IPayloadResponse> {
    const jobEntries = job?.input?.body?.data || [];

    // Create response entries by appending a success status to each original entry.
    const responseEntries: BundleEntry[] = jobEntries.map((entry: BundleEntry) => ({
      ...entry,
      response: {
        status: '200',
      },
    }));

    const responseBundle: Bundle = {
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    // Determine the issuer's DID based on the tenantId from the job.
    const issuerDid = (job.tenantId && job.tenantId !== 'host')
      ? getTenantDidWebId(job.tenantId)
      : getHostDidWebId();

    // Construct the final JARM-compliant response payload.
    return {
      thid: job.input.thid,
      iss: issuerDid,
      aud: job.input.iss,   // The response is for the original requester
      exp: Math.floor(Date.now() / 1000) + 300, // Expires in 5 minutes
      body: responseBundle,
    };
  }
}
