import { randomUUID } from 'crypto';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/index';
import { GatewayEnvelopeTypes } from '../shared/gateway-response-types';
import { BundleType } from './bundle';

export function buildTransactionResponse(job: JobRequest, body: BundleJsonApi): IDecodedDidcommPayload {
  return {
    jti: randomUUID(),
    type: GatewayEnvelopeTypes.TransactionResponse,
    thid: job.content?.thid as string,
    iss: job.content?.aud as string,
    aud: job.content?.iss as string,
    body,
  };
}

export function buildSearchMatchesResponse(
  job: JobRequest,
  responseType: string,
  matches: any[],
): IDecodedDidcommPayload {
  return buildTransactionResponse(job, {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: BundleType.BatchResponse,
    data: [{
      type: responseType,
      resource: { total: matches.length, data: matches },
      response: { status: '200' },
    } as any],
    total: 1,
  });
}
