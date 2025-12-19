// src/utils/consent.ts

import { createHash } from 'crypto';

export type ConsentRuleKeyParts = {
  subjectId: string;
  sector: string;
  target: string;
  decision: string;
  purpose: string;
};

function normalizeTarget(target: string): string {
  const trimmed = target.trim();
  if (/^[A-Z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (trimmed.includes('@') && !/\s/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

export function buildConsentRuleKey(parts: ConsentRuleKeyParts): string {
  const subjectId = parts.subjectId.trim();
  const sector = parts.sector.trim();
  const target = normalizeTarget(parts.target);
  const decision = parts.decision.trim().toLowerCase();
  const purpose = parts.purpose.trim();
  return `${subjectId}|${sector}|${target}|${decision}|${purpose}`;
}

export function hashConsentRuleId(ruleKey: string): string {
  return createHash('sha3-384').update(ruleKey, 'utf8').digest('hex');
}

