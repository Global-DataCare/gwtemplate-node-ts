// src/managers/ConsentManager.ts

import { createHash, randomUUID } from 'crypto';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { BundleEntryRequest, BundleJsonApi, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConsentRule, ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { buildConsentRuleKey, hashConsentRuleId } from '../utils/consent';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { getTenantVaultId } from '../utils/tenant';
import { getIndividualSectionId } from '../utils/individual-sections';
import { IJobProcessor } from './registry';

export interface ConsentManagerDeps {
  vaultRepository: IVaultRepository;
}

const requiredClaims = [
  ClaimConsent.decision,
  ClaimConsent.subject,
  ClaimConsent.identifier,
  ClaimConsent.date,
  ClaimConsent.purpose,
  ClaimConsent.action,
  ClaimConsent.actorRole,
  ClaimConsent.attachmentContentType,
  ClaimConsent.attachmentData,
];

export class ConsentManager implements IJobProcessor {
  private readonly vaultRepository: IVaultRepository;

  constructor(deps: ConsentManagerDeps) {
    this.vaultRepository = deps.vaultRepository;
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const body = job.content?.body as any;
    const bundle = body as BundleJsonApi<BundleEntryRequest>;
    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    const entries: any[] =
      (bundle && Array.isArray((bundle as any).data) && (bundle as any).data) ||
      (body && Array.isArray(body.entry) && body.entry) ||
      [];

    for (const entry of entries) {
        const rawClaims =
          ((entry as any)?.meta?.claims as Record<string, any> | undefined) ??
          ((entry as any)?.resource?.meta?.claims as Record<string, any> | undefined);

        try {
            if (!rawClaims) {
                throw new Error('Missing claims object in resource meta');
            }

            // Normalize contextualized claims:
            // - If `@context` is set (e.g. `org.hl7.fhir.r4`) and keys are sent without that prefix,
            //   prepend `${@context}.` and sort keys alphabetically (canonical form).
            const claims = normalizeContextualizedClaims(rawClaims) as Record<string, any>;

            // Backward/forward compatibility:
            // - Support `Consent.actor-reference` as an alias of `Consent.actor-identifier`.
            const actorIdentifier =
              getClaimValue<string>(claims, ClaimConsent.actorIdentifier) ??
              getClaimValue<string>(claims, 'Consent.actor-reference');
            if (actorIdentifier) {
              const context = claims['@context'];
              if (typeof context === 'string' && context.length > 0) {
                const prefixedKey = context.endsWith('.')
                  ? `${context}${ClaimConsent.actorIdentifier}`
                  : `${context}.${ClaimConsent.actorIdentifier}`;
                if (claims[prefixedKey] === undefined) claims[prefixedKey] = actorIdentifier;
              } else if (claims[ClaimConsent.actorIdentifier] === undefined) {
                claims[ClaimConsent.actorIdentifier] = actorIdentifier;
              }
            }

            for (const claimKey of requiredClaims) {
                if (!getClaimValue(claims, claimKey)) {
                    throw new Error(`Missing required claim: ${claimKey}`);
                }
            }
            if (!actorIdentifier) {
              throw new Error(`Missing required claim: ${ClaimConsent.actorIdentifier}`);
            }

            const subjectId = getClaimValue<string>(claims, ClaimConsent.subject);
            if (!subjectId) throw new Error(`Missing required claim: ${ClaimConsent.subject}`);
            const ruleKey = buildConsentRuleKey({
              subjectId: subjectId,
              sector: job.sector as string,
              target: actorIdentifier,
              decision: getClaimValue<string>(claims, ClaimConsent.decision) as string,
              purpose: getClaimValue<string>(claims, ClaimConsent.purpose) as string,
            });
            const ruleId = hashConsentRuleId(ruleKey);
            const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
            const individualRulesSectionId = getIndividualSectionId(subjectId, 'rules');

            const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
            if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

            // 1. Handle the attachment
            const attachmentDataBase64 = getClaimValue<string>(claims, ClaimConsent.attachmentData);
            if (!attachmentDataBase64) { throw new Error('Attachment data is missing.'); }
            const decodedData = Buffer.from(attachmentDataBase64, 'base64');
            const attachmentHash = createHash('sha3-384').update(decodedData).digest('hex');

            const attachmentRecord: RecordBase & { data: string; contentType: string } = {
                id: attachmentHash,
                data: attachmentDataBase64,
                contentType: getClaimValue<string>(claims, ClaimConsent.attachmentContentType) as string,
            };

            await this.vaultRepository.put(
                tenantVaultId,
                [attachmentRecord],
                getIndividualSectionId(subjectId, 'attachments')
            );

            // 2. Create and store the rule
            const ruleToStore: Record<string, any> = { ...claims };
            const context = ruleToStore['@context'];
            if (typeof context === 'string' && context.length > 0) {
              const prefix = context.endsWith('.') ? context : `${context}.`;
              delete ruleToStore[`${prefix}${ClaimConsent.attachmentData}`];
              delete ruleToStore[`${prefix}Consent.actor-reference`];
              ruleToStore[`${prefix}${ClaimConsent.attachmentId}`] = attachmentHash;
            }
            delete ruleToStore[ClaimConsent.attachmentData];
            delete ruleToStore['Consent.actor-reference'];
            ruleToStore[ClaimConsent.attachmentId] = attachmentHash;

            const consentRule: ConsentRule & RecordBase = {
              ...(ruleToStore as any),
              id: ruleId,
            };

            await this.vaultRepository.put(tenantVaultId, [consentRule], individualRulesSectionId);

            responseEntries.push({
                response: {
                    status: '201',
                    location: `/${job.sector}/individual/org.hl7.fhir.api/Consent/${ruleId}`,
                },
                type: 'Consent'
            });

        } catch (e: any) {
            const status = e.message.includes('not found') ? '404' : '400';
            const issueType = status === '404' ? IssueType.NotFound : IssueType.Invalid;
            responseEntries.push({
                response: {
                    status: status,
                    outcome: createOperationOutcome(IssueLevel.Error, issueType, e.message),
                },
                meta: { claims: rawClaims || {} },
                type: 'Consent'
            });
        }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      data: responseEntries,
    };

    const result: IDecodedDidcommPayload = {
      jti: randomUUID(),
      type: 'transaction-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
    return result;
  }
}
