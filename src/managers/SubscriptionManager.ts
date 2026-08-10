import { randomUUID } from 'crypto';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { createOperationOutcome } from '../utils/outcome';
import { getEnvSectionId } from '../utils/section-env';
import { getTenantVaultId } from '../utils/tenant';
import type { ITenantsManager } from './ITenantsManager';
import type { IJobProcessor } from './registry';

export interface SubscriptionManagerDeps {
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantsCacheManager?: ITenantsManager;
}

/** Persists the standards-based FHIR R5 Subscription registration profile. */
export class SubscriptionManager implements IJobProcessor {
  constructor(private readonly deps: SubscriptionManagerDeps) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    if (String(job.format).toLowerCase() !== 'org.hl7.fhir.r5' || job.action !== '_batch') {
      throw new Error('SubscriptionManager supports only org.hl7.fhir.r5 Subscription/_batch.');
    }
    if (!['entity', SUBJECT_SECTION_INDIVIDUAL].includes(String(job.section))) {
      throw new Error('FHIR R5 Subscription must use the entity or individual section.');
    }
    if (!job.tenantId || !job.sector) throw new Error('Missing tenantId or sector.');

    const vaultId = getTenantVaultId(job.sector as string, job.tenantId);
    const tenantExists = this.deps.tenantsCacheManager
      ? await this.deps.tenantsCacheManager.tenantExists(vaultId)
      : await this.deps.vaultRepository.vaultExists(vaultId);
    const entries = Array.isArray((job.content?.body as any)?.entry) ? (job.content?.body as any).entry : [];
    const responseEntries: any[] = [];

    for (const entry of entries) {
      const resource = entry?.resource;
      try {
        if (!tenantExists) throw new Error(`Tenant vault not found: ${vaultId}`);
        this.validate(resource, String(job.section));
        const record: ConfidentialStorageDoc = {
          id: resource.id,
          status: resource.status,
          sequence: 0,
          content: { resource, scope: job.section, createdAt: new Date().toISOString() },
        };
        const protectedRecord = await this.deps.kmsService.protectConfidentialData(record, vaultId);
        await this.deps.vaultRepository.put(
          vaultId,
          [protectedRecord],
          getEnvSectionId('fhir-r5-subscriptions'),
        );
        responseEntries.push({
          type: 'Subscription',
          response: {
            status: '201',
            location: `/${job.tenantId}/cds-${job.jurisdiction}/v1/${job.sector}/${job.section}/org.hl7.fhir.r5/Subscription/${resource.id}`,
          },
        });
      } catch (error: any) {
        responseEntries.push({
          type: 'Subscription',
          response: {
            status: error.message.includes('not found') ? '404' : '400',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, error.message),
          },
        });
      }
    }

    return {
      jti: randomUUID(),
      type: 'transaction-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: { resourceType: 'Bundle', type: '_batch-response', data: responseEntries },
    };
  }

  private validate(resource: any, section: string): void {
    if (!resource || resource.resourceType !== 'Subscription') {
      throw new Error('FHIR R5 Subscription entry requires resource.resourceType=Subscription.');
    }
    if (!String(resource.id || '').trim()) throw new Error('Subscription.id is required.');
    if (!['requested', 'off'].includes(String(resource.status))) {
      throw new Error('Subscription.status must be requested or off; only the delivery runtime may activate it.');
    }
    if (!String(resource.topic || '').trim()) throw new Error('Subscription.topic is required.');
    if (resource.channelType?.code !== 'rest-hook') {
      throw new Error('The current Subscription profile requires channelType rest-hook.');
    }
    let endpoint: URL;
    try { endpoint = new URL(String(resource.endpoint || '')); } catch {
      throw new Error('Subscription.endpoint must be an absolute HTTPS URL.');
    }
    if (endpoint.protocol !== 'https:') throw new Error('Subscription.endpoint must be an absolute HTTPS URL.');
    if (section === SUBJECT_SECTION_INDIVIDUAL) {
      const hasSubjectFilter = Array.isArray(resource.filterBy) && resource.filterBy.some((filter: any) =>
        ['patient', 'subject'].includes(String(filter?.filterParameter || '').toLowerCase())
        && String(filter?.value || '').trim()
        && !String(filter?.value || '').includes('*')
        && !String(filter?.value || '').includes(','),
      );
      if (!hasSubjectFilter) throw new Error('An individual Subscription requires an exact patient or subject filter.');
    }
  }
}
