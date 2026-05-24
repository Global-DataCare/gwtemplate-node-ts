// src/managers/OpenIdAuthManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { TenantsCacheManager } from './TenantsCacheManager';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getClaimValue } from '../utils/claims';
import { parseActorFromSub } from 'gdc-common-utils-ts/utils/actor';
import { getIndividualSectionId } from '../utils/individual-sections';
import { IClearingHouseService } from '../services/ClearingHouseService';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { expandConsentActorRoles, normalizeConsentActorRole } from '../utils/consent';

type TokenRequestBody = {
  scope?: string;
  sub?: string;
  expires_in?: number;
  token_type?: string;
  purpose?: string;
  vp_token?: string;
  presentation_submission?: any;
  acr_values?: string | string[];
};

export class OpenIdAuthManager implements IJobProcessor {
  constructor(
    private readonly kmsService: IKmsService,
    private readonly tenantsCacheManager: TenantsCacheManager,
    private readonly vaultRepository: IVaultRepository,
    private readonly clearingHouseService: IClearingHouseService,
  ) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid;
    if (!thid) {
      throw new ManagerError('Missing thid in token request.', IssueType.Required);
    }
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector in token request.', IssueType.Required);
    }
    if (!job.jurisdiction) {
      throw new ManagerError('Missing jurisdiction in token request.', IssueType.Required);
    }

    const body = (job.content?.body || {}) as TokenRequestBody;
    const scope = body.scope?.trim();
    if (!scope) {
      throw new ManagerError("Missing 'scope' in token request body.", IssueType.Required);
    }

    const sub = body.sub?.trim();
    if (!sub) {
      throw new ManagerError("Missing 'sub' in token request body.", IssueType.Required);
    }

    const vpToken = body.vp_token?.trim();
    if (!vpToken) {
      throw new ManagerError("Missing 'vp_token' in token request body.", IssueType.Required);
    }

    const acrValues = this.normalizeAcrValues(body.acr_values);
    if (acrValues.length === 0) {
      throw new ManagerError("Missing 'acr_values' in token request body.", IssueType.Required);
    }

    const clearingResult = await this.clearingHouseService.verifyVpToken({
      vpToken,
      presentationSubmission: body.presentation_submission,
      acrValues,
    });

    if (!acrValues.includes(clearingResult.acr)) {
      throw new ManagerError('Clearing House returned an unexpected acr value.', IssueType.Forbidden);
    }

    // --- Gateway SMART Scope Extension: Context Pinning ---
    // Require a root scope item of the form:
    //   organization/Composition.<cruds>?subject=<did:web:...:individual:<id>>[&section=*|<code>[,<code>...]]
    // An omitted section means the backend's default permitted set for that subject.
    const { subject, sections } = this.extractPinnedSubjectAndSections(scope);
    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const tenantExists = await this.vaultRepository.vaultExists(tenantVaultId);
    if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);

    // --- Consent Rule Check (MVP) ---
    // This is a minimal permission gate to support unit/integration tests.
    // A stricter implementation should:
    // - verify the request signature and bind `sub` to a registered employee/practitioner identity,
    // - parse all scope items and map to rule semantics (resource-level + section-level),
    // - apply deny-overrides and purpose logic.
    const actor = parseActorFromSub(sub);
    const purpose = body.purpose?.trim();
    const rules = await this.vaultRepository.getContainersInSection<any>(tenantVaultId, getIndividualSectionId(subject, 'rules'));
    const evaluation = this.evaluateRequestedConsent({
      rules,
      subject,
      actor,
      purpose,
      sections,
      jurisdiction: job.jurisdiction,
    });

    if (!evaluation.allowed) {
      const missingSections = evaluation.missingSections.map((value) => normalizeCodeSystemAndValue(value)).filter(Boolean);
      const detail = [
        missingSections.length ? `missing sections=${missingSections.join(',')}` : '',
        evaluation.missingResourceTypes.length ? `missing resourceTypes=${evaluation.missingResourceTypes.join(',')}` : '',
      ].filter(Boolean).join('; ');
      throw new ManagerError(
        detail
          ? `No matching consent rule found for requested scope. ${detail}`
          : 'No matching consent rule found for requested scope.',
        IssueType.Forbidden,
      );
    }

    const lifetimeSeconds = Math.max(1, Math.min(3600, body.expires_in || 300));
    const tokenType = body.token_type || 'Bearer';

    const issuerVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);
    const issuerDidDoc = await this.tenantsCacheManager.getDidDocument(issuerVaultId);
    const issuerDid = issuerDidDoc?.id || job.content?.aud;
    if (!issuerDid) {
      throw new ManagerError('Could not resolve token issuer DID.', IssueType.Exception);
    }

    const legacyEnabled = process.env.SMART_TOKEN_LEGACY !== 'false';
    const legacyAlgCandidate = (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
      ? process.env.LEGACY_SIGN_ALG
      : 'ES384';
    let signingKey = await this.kmsService.getPublicVerificationKey(issuerVaultId, undefined, 'comm_sig');
    if (legacyEnabled) {
      const legacyKey = await this.kmsService.getPublicVerificationKey(issuerVaultId, legacyAlgCandidate, 'comm_sig');
      if (legacyKey?.kid) {
        signingKey = legacyKey;
      }
    }
    if (!signingKey?.kid) {
      throw new ManagerError('Could not resolve issuer signing key.', IssueType.Exception);
    }

    const now = Math.floor(Date.now() / 1000);
    const signingAlg = (signingKey as { alg?: string }).alg || 'ML-DSA-44';
    const jwtHeader = { alg: signingAlg, typ: 'JWT', kid: signingKey.kid };
    const jwtPayload = {
      iss: issuerDid,
      sub,
      aud: issuerDid,
      scope,
      iat: now,
      nbf: now,
      exp: now + lifetimeSeconds,
      acr: clearingResult.acr,
      amr: clearingResult.amr,
      vp_hash: clearingResult.vpHash,
      ledger_verified: clearingResult.ledgerVerified,
    };

    const encodedHeader = Content.stringToBase64Url(JSON.stringify(jwtHeader));
    const encodedPayload = Content.stringToBase64Url(JSON.stringify(jwtPayload));
    const bytesToSign = Content.stringToBytesUTF8(`${encodedHeader}.${encodedPayload}`);
    const jwsObject = await this.kmsService.signWithManagedKey(bytesToSign, issuerVaultId, signingAlg, 'comm_sig');
    const signature = jwsObject.signatures[0]?.signature;
    if (!signature) {
      throw new ManagerError('Failed to sign access token.', IssueType.Exception);
    }

    const accessToken = `${encodedHeader}.${encodedPayload}.${signature}`;

    return {
      jti: job.content?.jti || thid,
      thid,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: now + lifetimeSeconds,
      type: 'application/json',
      body: {
        access_token: accessToken,
        token_type: tokenType,
        expires_in: lifetimeSeconds,
        scope,
        subject,
        ledger_verified: clearingResult.ledgerVerified,
      },
    };
  }

  private extractPinnedSubjectAndSections(scope: string): { subject: string; sections: string[] } {
    const scopes = scope.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const rootScopes = scopes.filter((s) => s.toLowerCase().startsWith('organization/composition.'));
    if (rootScopes.length === 0) {
      throw new ManagerError('Missing required root scope: organization/Composition.<cruds>?subject=...', IssueType.Required);
    }

    const parsed = rootScopes.map((root) => {
      const [head, queryString] = root.split('?', 2);
      if (!queryString) {
        throw new ManagerError(`Invalid root scope (missing query): ${head}`, IssueType.Value);
      }
      const params = new URLSearchParams(queryString);
      const subject = params.get('subject')?.trim();
      if (!subject) {
        throw new ManagerError(`Invalid root scope (missing subject): ${head}`, IssueType.Required);
      }
      const sectionParam = params.get('section')?.trim() || '';
      const sections = sectionParam.includes('*')
        ? []
        : sectionParam
            .split(',')
            .map((s) => normalizeCodeSystemAndValue(s.trim()))
            .filter(Boolean);
      return { subject, sections };
    });

    const subject = parsed[0].subject;
    if (!parsed.every((p) => p.subject === subject)) {
      throw new ManagerError('Token request must be single-subject: all root scopes must have the same subject.', IssueType.Forbidden);
    }

    const mergedSections = Array.from(new Set(parsed.flatMap((p) => p.sections)));
    return { subject, sections: mergedSections };
  }

  private normalizeAcrValues(acrValues?: string | string[]): string[] {
    if (!acrValues) return [];
    if (Array.isArray(acrValues)) {
      return acrValues.map((value) => value.trim()).filter(Boolean);
    }
    return acrValues
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private extractRequestedResourceTypes(scope: string): string[] {
    const resourceTypes = new Set<string>();
    for (const token of scope.split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      const [head] = token.split('?', 1);
      const target = head.split('/')[1] || '';
      const resourceType = target.split('.')[0]?.trim();
      if (resourceType) resourceTypes.add(resourceType);
    }
    return Array.from(resourceTypes);
  }

  private evaluateRequestedConsent(input: {
    rules: any[];
    subject: string;
    actor: ReturnType<typeof parseActorFromSub>;
    purpose?: string;
    sections: string[];
    jurisdiction: string;
  }): {
    allowed: boolean;
    missingSections: string[];
    missingResourceTypes: string[];
  } {
    const missingSections: string[] = [];
    const missingResourceTypes: string[] = [];
    const normalizedActorRole = input.actor.role?.trim()
      ? normalizeConsentActorRole(input.actor.role.trim(), input.actor.sub.includes(':family:') ? 'family' : 'professional')
      : undefined;
    const normalizedJurisdiction = String(input.jurisdiction || '').trim().toUpperCase();
    const actorEmail = input.actor.identifier && input.actor.identifier.includes('@')
      ? input.actor.identifier.toLowerCase()
      : undefined;

    for (const section of input.sections.length > 0 ? input.sections : ['*']) {
      const normalizedSection = section === '*' ? '*' : normalizeCodeSystemAndValue(section);
      const candidates = (input.rules || [])
        .filter((rule) => String(getClaimValue<string>(rule, 'Consent.subject') || '').trim() === input.subject)
        .filter((rule) => this.isRuleTimeActive(rule))
        .filter((rule) => this.matchesRulePurpose(rule, input.purpose))
        .filter((rule) => this.matchesRuleRole(rule, normalizedActorRole, actorEmail))
        .filter((rule) => this.matchesRuleSection(rule, normalizedSection))
        .map((rule) => {
          const match = this.resolveRuleMatchKind(rule, input.actor, actorEmail, normalizedJurisdiction);
          if (!match) return undefined;
          return {
            rule,
            precedence: this.resolvePrecedence(rule, match),
          };
        })
        .filter((value): value is { rule: any; precedence: number } => Boolean(value))
        .sort((a, b) => a.precedence - b.precedence);

      const winner = candidates[0];
      if (!winner || String(getClaimValue<string>(winner.rule, 'Consent.decision') || '').trim() !== 'permit') {
        if (normalizedSection !== '*') missingSections.push(normalizedSection);
      }
    }

    return {
      allowed: missingSections.length === 0 && missingResourceTypes.length === 0,
      missingSections: Array.from(new Set(missingSections)),
      missingResourceTypes: Array.from(new Set(missingResourceTypes)),
    };
  }

  private isRuleTimeActive(rule: any): boolean {
    const now = Date.now();
    const start = String(getClaimValue<string>(rule, 'Consent.period-start') || '').trim();
    const end = String(getClaimValue<string>(rule, 'Consent.period-end') || '').trim();
    if (start && !Number.isNaN(Date.parse(start)) && Date.parse(start) > now) return false;
    if (end && !Number.isNaN(Date.parse(end)) && Date.parse(end) < now) return false;
    return true;
  }

  private matchesRulePurpose(rule: any, purpose?: string): boolean {
    const rulePurpose = String(getClaimValue<string>(rule, 'Consent.purpose') || '').trim();
    if (!purpose || !rulePurpose) return true;
    return rulePurpose === purpose;
  }

  private matchesRuleRole(rule: any, normalizedActorRole?: string, actorEmail?: string): boolean {
    const ruleRole = String(getClaimValue<string>(rule, 'Consent.actor-role') || '').trim();
    if (!ruleRole) return !normalizedActorRole || !!actorEmail;
    const normalizedRuleRoles = expandConsentActorRoles(ruleRole, normalizedActorRole?.startsWith('v3-rolecode|') ? 'family' : 'professional');
    if (normalizedRuleRoles.includes('*')) return !!actorEmail;
    if (!normalizedActorRole) return false;
    return normalizedRuleRoles.includes(normalizedActorRole);
  }

  private matchesRuleSection(rule: any, normalizedSection: string): boolean {
    if (!normalizedSection || normalizedSection === '*') return true;
    const actions = String(getClaimValue<string>(rule, 'Consent.action') || '')
      .split(',')
      .map((value) => normalizeCodeSystemAndValue(value.trim()))
      .filter(Boolean);
    return actions.includes('*') || actions.includes(normalizedSection);
  }

  private resolveRuleMatchKind(
    rule: any,
    actor: ReturnType<typeof parseActorFromSub>,
    actorEmail: string | undefined,
    jurisdiction: string,
  ): 'direct' | 'organization' | 'jurisdiction' | undefined {
    const ruleActor = String(getClaimValue<string>(rule, 'Consent.actor-identifier') || '').trim();
    if (!ruleActor) return undefined;

    if (actorEmail && ruleActor.toLowerCase() === actorEmail) return 'direct';
    if (ruleActor === actor.sub) return 'direct';

    if (ruleActor.startsWith('did:web:')) {
      if (actor.organization && (ruleActor === actor.organization || ruleActor.startsWith(`${actor.organization}:`))) {
        return ruleActor === actor.sub ? 'direct' : 'organization';
      }
      if (ruleActor === actor.sub) return 'direct';
    }

    const normalizedRuleJurisdiction = this.normalizeJurisdictionRuleActor(ruleActor);
    if (normalizedRuleJurisdiction && normalizedRuleJurisdiction === jurisdiction) return 'jurisdiction';

    return undefined;
  }

  private normalizeJurisdictionRuleActor(ruleActor: string): string | undefined {
    const direct = String(ruleActor || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(direct)) return direct;
    const isoStd = direct.match(/^URN:ISO:STD:ISO:3166\|([A-Z]{2})$/);
    if (isoStd) return isoStd[1];
    const iso = direct.match(/^URN:ISO:3166(?:-2)?:([A-Z]{2})(?:[-:].*)?$/);
    if (iso) return iso[1];
    return undefined;
  }

  private resolvePrecedence(rule: any, matchKind: 'direct' | 'organization' | 'jurisdiction'): number {
    const decision = String(getClaimValue<string>(rule, 'Consent.decision') || '').trim();
    if (matchKind === 'direct') return decision === 'deny' ? 10 : 11;
    if (matchKind === 'organization') return decision === 'deny' ? 20 : 21;
    return decision === 'deny' ? 30 : 31;
  }
}
