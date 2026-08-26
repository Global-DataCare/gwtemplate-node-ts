import { createHash } from 'crypto';
import { ConsentRule, ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getClaimValue } from './claims';
import { buildConsentRuleStorageKey, hashConsentRuleId } from './consent';
import { getIndividualSectionId, getSubjectScopedSectionId } from './individual-sections';
import { applyDigitalTwinSecondaryUseDecision } from './digital-twin-secondary-use';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';

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

const requiredConsentRuleClaims = requiredConsentClaims.filter((claim) => (
  claim !== ClaimConsent.identifier
  && claim !== ClaimConsent.attachmentContentType
  && claim !== ClaimConsent.attachmentData
));

export function isDigitalTwinSecondaryUseConsent(claims: Record<string, any>): boolean {
  const purpose = String(getClaimValue(claims, ClaimConsent.purpose) || '').trim().toUpperCase();
  const actions = String(getClaimValue(claims, ClaimConsent.action) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    purpose === HealthcareConsentPurposes.Research || purpose === 'RESEARCH'
  ) && actions.some((action) => (
    action === ServiceCapability.DigitalTwinReader || action === ServiceCapability.DigitalTwinProvider
  ));
}

export function requiredConsentClaimsFor(claims: Record<string, any>): readonly ClaimConsent[] {
  return isDigitalTwinSecondaryUseConsent(claims)
    ? [...requiredConsentRuleClaims, ClaimConsent.sourceReference]
    : requiredConsentClaims;
}

function setClaimValue(claims: Record<string, any>, key: ClaimConsent, value: string): void {
  const context = String(claims['@context'] || '').trim();
  if (context) {
    const prefix = context.endsWith('.') ? context : `${context}.`;
    claims[`${prefix}${key}`] = value;
    delete claims[key];
    return;
  }
  claims[key] = value;
}

function uuidFromHash(seed: string): string {
  const bytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Assigns GW's internal Consent identifier for one application/study rule.
 * Callers identify the rule with Consent.source-reference and never own this id.
 */
export function ensureDigitalTwinSecondaryUseConsentIdentifier(input: {
  tenantVaultId: string;
  sector: string;
  claims: Record<string, any>;
}): string | undefined {
  if (!isDigitalTwinSecondaryUseConsent(input.claims)) return undefined;
  const subjectId = String(getClaimValue(input.claims, ClaimConsent.subject) || '').trim();
  const actorIdentifier = String(
    getClaimValue(input.claims, ClaimConsent.actorIdentifier)
    || getClaimValue(input.claims, 'Consent.actor-reference')
    || '',
  ).trim();
  const purpose = String(getClaimValue(input.claims, ClaimConsent.purpose) || '').trim().toUpperCase();
  const sourceReference = String(getClaimValue(input.claims, ClaimConsent.sourceReference) || '').trim();
  if (!sourceReference) throw new Error(`Missing required claim: ${ClaimConsent.sourceReference}`);
  if (!subjectId) throw new Error(`Missing required claim: ${ClaimConsent.subject}`);
  if (!actorIdentifier) throw new Error(`Missing required claim: ${ClaimConsent.actorIdentifier}`);

  const semanticKey = [
    input.tenantVaultId.trim(),
    input.sector.trim(),
    subjectId,
    actorIdentifier,
    purpose,
    ServiceCapability.DigitalTwinReader,
    sourceReference,
  ].join('|');
  const identifier = `urn:uuid:${uuidFromHash(semanticKey)}`;
  setClaimValue(input.claims, ClaimConsent.identifier, identifier);
  return identifier;
}

export type PersistConsentRuleInput = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  sector: string;
  claims: Record<string, any>;
  researchTags?: string[];
};

export async function persistConsentRuleAndAttachment(
  input: PersistConsentRuleInput,
): Promise<{ subjectId: string; attachmentHash?: string; ruleId: string }> {
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

  for (const claimKey of requiredConsentClaimsFor(claims)) {
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
  const attachmentContentType = getClaimValue<string>(claims, ClaimConsent.attachmentContentType);
  let attachmentHash: string | undefined;
  if (attachmentDataBase64 || attachmentContentType) {
    if (!attachmentDataBase64 || !attachmentContentType) {
      throw new Error('Consent attachment content type and data must be provided together.');
    }
    const decodedData = Buffer.from(attachmentDataBase64, 'base64');
    attachmentHash = createHash('sha3-384').update(decodedData).digest('hex');
    const attachmentRecord: RecordBase & { data: string; contentType: string } = {
      id: attachmentHash,
      data: attachmentDataBase64,
      contentType: attachmentContentType,
    };
    await vaultRepository.put(
      tenantVaultId,
      [attachmentRecord],
      getIndividualSectionId(subjectId, 'attachments'),
    );
  }

  const baseRuleKey = buildConsentRuleStorageKey({
    subjectId,
    sector,
    target: actorIdentifier,
    decision: getClaimValue<string>(claims, ClaimConsent.decision) as string,
    purpose: getClaimValue<string>(claims, ClaimConsent.purpose) as string,
  });
  const isDigitalTwinResearchConsent = isDigitalTwinSecondaryUseConsent(claims);
  const sourceReference = String(getClaimValue(claims, ClaimConsent.sourceReference) || '').trim();
  const ruleKey = isDigitalTwinResearchConsent
    ? `${baseRuleKey}|${sourceReference}`
    : baseRuleKey;
  const ruleId = hashConsentRuleId(ruleKey);

  const ruleToStore: Record<string, any> = { ...claims };
  const context = ruleToStore['@context'];
  if (typeof context === 'string' && context.length > 0) {
    const prefix = context.endsWith('.') ? context : `${context}.`;
    delete ruleToStore[`${prefix}${ClaimConsent.attachmentData}`];
    delete ruleToStore[`${prefix}Consent.actor-reference`];
    if (attachmentHash) ruleToStore[`${prefix}${ClaimConsent.attachmentId}`] = attachmentHash;
  }
  delete ruleToStore[ClaimConsent.attachmentData];
  delete ruleToStore['Consent.actor-reference'];
  if (attachmentHash) ruleToStore[ClaimConsent.attachmentId] = attachmentHash;

  const consentRule: ConsentRule & RecordBase = {
    ...(ruleToStore as any),
    id: ruleId,
  };
  if (researchTags && researchTags.length > 0) {
    (consentRule as any).meta = { tag: researchTags };
    (consentRule as any).tag = researchTags;
  }

  await vaultRepository.put(tenantVaultId, [consentRule], getIndividualSectionId(subjectId, 'rules'));
  await vaultRepository.put(
    tenantVaultId,
    [consentRule],
    getSubjectScopedSectionId(subjectId, 'individual', 'consents'),
  );
  await applyDigitalTwinSecondaryUseDecision({ vaultRepository, tenantVaultId, claims });
  return { subjectId, attachmentHash, ruleId };
}
