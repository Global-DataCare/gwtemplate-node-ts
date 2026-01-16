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

type TokenRequestBody = {
  scope?: string;
  sub?: string;
  expires_in?: number;
  token_type?: string;
  purpose?: string;
};

export class OpenIdAuthManager implements IJobProcessor {
  constructor(
    private readonly kmsService: IKmsService,
    private readonly tenantsCacheManager: TenantsCacheManager,
    private readonly vaultRepository: IVaultRepository,
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

    // --- Gateway SMART Scope Extension: Context Pinning ---
    // Require a root scope item of the form:
    //   patient/Composition.<cruds>?subject=<did:web:...:individual:<id>>[&section=...]
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
    const actorRole = actor.role?.trim();
    const purpose = body.purpose?.trim();

    const jurisdiction = job.jurisdiction.toUpperCase();
    const jurisdictionActorIds: string[] = [];
    if (jurisdiction.includes('-')) {
      jurisdictionActorIds.push(`urn:iso:3166-2:${jurisdiction}`);
    } else {
      jurisdictionActorIds.push(`urn:iso:3166:${jurisdiction}`);
      jurisdictionActorIds.push(`urn:iso:3166-2:${jurisdiction}`);
    }

    const rules = await this.vaultRepository.getContainersInSection<any>(tenantVaultId, getIndividualSectionId(subject, 'rules'));
    const matchingRule = rules.find((rule) => {
      const decision = getClaimValue<string>(rule as any, 'Consent.decision');
      if (decision !== 'permit') return false;

      const ruleActor = getClaimValue<string>(rule as any, 'Consent.actor-identifier');
      if (!ruleActor) return false;

      // Actor matching supports 3 "actor-identifier" types:
      // 1) Jurisdiction URNs (ISO country/subdivision) => match the request jurisdiction.
      // 2) did:web (organization/department/office) => match the actor's base org did:web.
      // 3) Email => match the actor email.
      const normalizedRuleActor = ruleActor.trim();
      const isRuleEmail = normalizedRuleActor.includes('@') && !/\s/.test(normalizedRuleActor) && !normalizedRuleActor.startsWith('did:');
      const isRuleDidWeb = normalizedRuleActor.startsWith('did:web:');
      const isRuleJurisdictionUrn = normalizedRuleActor.startsWith('urn:iso:');

      if (isRuleJurisdictionUrn) {
        if (!jurisdictionActorIds.includes(normalizedRuleActor)) return false;
      } else if (isRuleDidWeb) {
        if (!actor.organization) return false;
        // A rule may refer to the tenant DID (base) or a more specific department/office DID under the same host.
        if (!(normalizedRuleActor === actor.organization || normalizedRuleActor.startsWith(`${actor.organization}:`))) {
          return false;
        }
      } else if (isRuleEmail) {
        const actorEmail = actor.email;
        if (!actorEmail) return false;
        if (normalizedRuleActor.toLowerCase() !== actorEmail) return false;
      } else {
        return false;
      }

      const ruleRole = getClaimValue<string>(rule as any, 'Consent.actor-role');
      if (ruleRole) {
        const normalizedRuleRole = ruleRole.trim();
        if (normalizedRuleRole === '*') {
          // Wildcard roles are only permitted for email-based rules.
          if (!isRuleEmail) return false;
        } else if (actorRole) {
          if (normalizedRuleRole !== actorRole) return false;
        } else {
          // If the actor doesn't carry a role, only email rules with wildcard roles can match.
          return false;
        }
      } else if (actorRole) {
        // If the rule doesn't specify a role, allow only for email-based rules (role-less external actors).
        if (!isRuleEmail) return false;
      }

      const rulePurpose = getClaimValue<string>(rule as any, 'Consent.purpose');
      if (purpose && rulePurpose && rulePurpose !== purpose) return false;

      if (sections.length > 0) {
        const ruleActions = (getClaimValue<string>(rule as any, 'Consent.action') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        return sections.every((s) => ruleActions.includes(s));
      }
      return true;
    });

    if (!matchingRule) {
      throw new ManagerError('No matching consent rule found for requested scope.', IssueType.Forbidden);
    }

    const lifetimeSeconds = Math.max(1, Math.min(3600, body.expires_in || 300));
    const tokenType = body.token_type || 'Bearer';

    const issuerVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);
    const issuerDidDoc = await this.tenantsCacheManager.getDidDocument(issuerVaultId);
    const issuerDid = issuerDidDoc?.id || job.content?.aud;
    if (!issuerDid) {
      throw new ManagerError('Could not resolve token issuer DID.', IssueType.Exception);
    }

    const signingKey = await this.kmsService.getPublicVerificationKey(issuerVaultId);
    if (!signingKey?.kid) {
      throw new ManagerError('Could not resolve issuer signing key.', IssueType.Exception);
    }

    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = { alg: 'ML-DSA-44', typ: 'JWT', kid: signingKey.kid };
    const jwtPayload = {
      iss: issuerDid,
      sub,
      aud: issuerDid,
      scope,
      iat: now,
      nbf: now,
      exp: now + lifetimeSeconds,
    };

    const encodedHeader = Content.stringToBase64Url(JSON.stringify(jwtHeader));
    const encodedPayload = Content.stringToBase64Url(JSON.stringify(jwtPayload));
    const bytesToSign = Content.stringToBytesUTF8(`${encodedHeader}.${encodedPayload}`);
    const jwsObject = await this.kmsService.signWithManagedKey(bytesToSign, issuerVaultId);
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
      },
    };
  }

  private extractPinnedSubjectAndSections(scope: string): { subject: string; sections: string[] } {
    const scopes = scope.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const rootScopes = scopes.filter((s) => s.toLowerCase().startsWith('patient/composition.'));
    if (rootScopes.length === 0) {
      throw new ManagerError('Missing required root scope: patient/Composition.<cruds>?subject=...', IssueType.Required);
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
      const sections = sectionParam
        .split(',')
        .map((s) => s.trim())
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
}
