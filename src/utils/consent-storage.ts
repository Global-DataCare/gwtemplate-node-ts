import { createHash } from 'crypto';
import { ConsentRule, ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getClaimValue } from './claims';
import { buildConsentRuleKey, hashConsentRuleId } from './consent';
import { getIndividualSectionId } from './individual-sections';

export const requiredConsentClaims = [
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

export type PersistConsentRuleInput = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  sector: string;
  claims: Record<string, any>;
  researchTags?: string[];
};

export async function persistConsentRuleAndAttachment(
  input: PersistConsentRuleInput,
): Promise<{ subjectId: string; attachmentHash: string; ruleId: string }> {
  const { vaultRepository, tenantVaultId, sector, claims, researchTags } = input;

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

  for (const claimKey of requiredConsentClaims) {
    if (!getClaimValue(claims, claimKey)) {
      throw new Error(`Missing required claim: ${claimKey}`);
    }
  }
  if (!actorIdentifier) {
    throw new Error(`Missing required claim: ${ClaimConsent.actorIdentifier}`);
  }

  const subjectId = getClaimValue<string>(claims, ClaimConsent.subject);
  if (!subjectId) throw new Error(`Missing required claim: ${ClaimConsent.subject}`);

  const attachmentDataBase64 = getClaimValue<string>(claims, ClaimConsent.attachmentData);
  if (!attachmentDataBase64) throw new Error('Attachment data is missing.');
  const decodedData = Buffer.from(attachmentDataBase64, 'base64');
  const attachmentHash = createHash('sha3-384').update(decodedData).digest('hex');

  const attachmentRecord: RecordBase & { data: string; contentType: string } = {
    id: attachmentHash,
    data: attachmentDataBase64,
    contentType: getClaimValue<string>(claims, ClaimConsent.attachmentContentType) as string,
  };

  await vaultRepository.put(
    tenantVaultId,
    [attachmentRecord],
    getIndividualSectionId(subjectId, 'attachments'),
  );

  const ruleKey = buildConsentRuleKey({
    subjectId,
    sector,
    target: actorIdentifier,
    decision: getClaimValue<string>(claims, ClaimConsent.decision) as string,
    purpose: getClaimValue<string>(claims, ClaimConsent.purpose) as string,
  });
  const ruleId = hashConsentRuleId(ruleKey);

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
  if (researchTags && researchTags.length > 0) {
    (consentRule as any).meta = { tag: researchTags };
    (consentRule as any).tag = researchTags;
  }

  await vaultRepository.put(tenantVaultId, [consentRule], getIndividualSectionId(subjectId, 'rules'));
  return { subjectId, attachmentHash, ruleId };
}
