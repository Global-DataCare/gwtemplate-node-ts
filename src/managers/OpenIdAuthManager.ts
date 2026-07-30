// src/managers/OpenIdAuthManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ITenantsManager } from './ITenantsManager';
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
import { getMatchingInterTenantAccessContractFromVpToken } from 'gdc-common-utils-ts/utils/inter-tenant-access-contract';
import { getMatchingSubjectIdentityBindingFromVpToken } from 'gdc-common-utils-ts/utils/subject-identity-binding';
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { getEnvSectionId } from '../utils/section-env';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { deriveGrantedSmartScopes } from 'gdc-common-utils-ts/utils/smart-scope';
import type { ConsentRule } from 'gdc-common-utils-ts/models/consent-rule';
import { getMatchingIndividualMemberCredentialFromVpToken } from 'gdc-common-utils-ts/utils/individual-smart';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';

type TokenRequestBody = {
  client_id?: string;
  client_assertion?: string;
  client_assertion_type?: string;
  scope?: string;
  sub?: string;
  expires_in?: number;
  token_type?: string;
  purpose?: string;
  vp_token?: string;
  presentation_submission?: any;
  acr_values?: string | string[];
};

type AccessProofResult = {
  mode: 'vp_token' | 'external_research_bearer';
  acr: string;
  amr: string[];
  vpHash?: string;
  ledgerVerified: boolean;
};

type ParsedPermission = {
  raw: string;
  capability: string;
  resourceType: string;
  filters: Record<string, string[]>;
};

export class OpenIdAuthManager implements IJobProcessor {
  constructor(
    private readonly kmsService: IKmsService,
    private readonly tenantsCacheManager: ITenantsManager,
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
    const clientId = body.client_id?.trim();
    const scope = body.scope?.trim();
    if (!scope) {
      throw new ManagerError("Missing 'scope' in token request body.", IssueType.Required);
    }

    const sub = body.sub?.trim();
    if (!sub) {
      throw new ManagerError("Missing 'sub' in token request body.", IssueType.Required);
    }

    const acrValues = this.normalizeAcrValues(body.acr_values);
    if (acrValues.length === 0) {
      throw new ManagerError("Missing 'acr_values' in token request body.", IssueType.Required);
    }

    // --- Gateway SMART Scope Extension: Context Pinning ---
    // Require a root scope item of the form:
    //   organization/Composition.<cruds>?subject=<did:web:...:individual:<id>>[&section=*|<code>[,<code>...]]
    // An omitted section means the backend's default permitted set for that subject.
    const requestedPermissions = this.parseRequestedScopePermissions(scope);
    const { subject } = this.extractPinnedSubjectAndSections(scope);
    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
    const issuerDidDoc = await this.tenantsCacheManager.getDidDocument(tenantVaultId);
    const issuerDid = issuerDidDoc?.id || job.content?.aud;
    if (!issuerDid) {
      throw new ManagerError('Could not resolve token issuer DID.', IssueType.Exception);
    }

    await this.validateClientAssertion({
      body,
      clientId,
      issuerDid,
      tenantVaultId,
      requestIssuerDid: String(job.content?.iss || '').trim() || undefined,
    });

    // --- Consent Rule Check (MVP) ---
    // This is a minimal permission gate to support unit/integration tests.
    // A stricter implementation should:
    // - verify the request signature and bind `sub` to a registered employee/practitioner identity,
    // - parse all scope items and map to rule semantics (resource-level + section-level),
    // - apply deny-overrides and purpose logic.
    const actor = parseActorFromSub(sub);
    const purpose = body.purpose?.trim();
    const requestedCapabilities = this.extractRequestedCapabilities(scope);
    const isInterTenantResearchAccess = requestedCapabilities.some((capability) =>
      capability === ServiceCapability.DigitalTwinReader
      || capability === ServiceCapability.DigitalTwinProvider
    );
    const vpToken = body.vp_token?.trim();
    const accessProof = await this.resolveAccessProof({
      acrValues,
      actorOrganizationDid: actor.organization,
      issuerDid,
      purpose,
      requestedCapabilities,
      vpToken,
      presentationSubmission: body.presentation_submission,
      bearerPayload: (job.content as any)?.meta?.bearer?.jwt?.payload,
    });

    // Inter-tenant research contract gate:
    // - issuerDid = tenant that is about to issue the SMART token
    // - actor.organization = organization of the requesting professional/researcher
    // - only DigitalTwin/ResearchSubject capabilities represent the research
    //   contract boundary; individual Composition self-read remains governed
    //   by its subject-scoped consent rules
    // - when research actor and issuer differ, the VP must carry one contract
    //   VC proving:
    //   1. provider organization = issuer tenant (`acme`)
    //   2. consumer organization = foreign requester tenant (`lab`)
    //   3. capability allows the requested scope
    //      example: `organization/ResearchSubject.rs`
    //   4. purpose allows the requested business reason
    //      example: `RESEARCH`
    if (isInterTenantResearchAccess && actor.organization && actor.organization !== issuerDid) {
      if (accessProof.mode === 'vp_token') {
        const matchingContract = getMatchingInterTenantAccessContractFromVpToken(vpToken!, {
          providerOrganizationDid: issuerDid,
          consumerOrganizationDid: actor.organization,
          requiredCapabilities: requestedCapabilities,
          purpose,
        });
        if (!matchingContract) {
          throw new ManagerError(
            `No active inter-tenant access contract found for consumer '${actor.organization}'.`,
            IssueType.Forbidden,
          );
        }
      }
    }
    const actorSubjectAliases = new Set<string>([actor.sub]);
    let memberCredential: ReturnType<typeof getMatchingIndividualMemberCredentialFromVpToken>;
    let memberLicense: DeviceLicense | undefined;
    const isIndividualAccessProof = String(accessProof.acr || '').toLowerCase().includes('individual');
    if (!isInterTenantResearchAccess && isIndividualAccessProof && actor.sub !== subject) {
      const trustedIssuerDids = this.readTrustedSubjectIdentityBindingIssuers();
      memberCredential = accessProof.mode === 'vp_token'
        ? getMatchingIndividualMemberCredentialFromVpToken(vpToken!, {
            actorDid: actor.sub,
            subjectDid: subject,
            relationship: actor.role,
          })
        : undefined;
      const binding = accessProof.mode === 'vp_token'
        ? getMatchingSubjectIdentityBindingFromVpToken(vpToken!, {
            trustedIssuerDids,
            requiredSubjectDids: [actor.sub, subject],
            sector: job.sector,
          })
        : undefined;
      if (!binding && !memberCredential) {
        throw new ManagerError(
          `No trusted subject identity binding found between actor '${actor.sub}' and subject '${subject}'.`,
          IssueType.Forbidden,
        );
      }
      if (memberCredential) {
        memberLicense = await this.getActiveMemberLicense({
          tenantVaultId,
          subject,
          actorIdentifier: actor.identifier,
          actorRole: actor.role,
        });
        if (!memberLicense) {
          throw new ManagerError('No active individual-member license binds this actor to the requested subject.', IssueType.Forbidden);
        }
      }
      if (binding) {
        actorSubjectAliases.add(binding.subjectDid);
        binding.aliasDids.forEach((did) => actorSubjectAliases.add(did));
      }
      memberCredential?.sameAs.forEach((alias) => actorSubjectAliases.add(alias));
    }
    const rules = await this.vaultRepository.getContainersInSection<any>(tenantVaultId, getIndividualSectionId(subject, 'rules'));
    let grantedScope = scope;
    const requestedScopeTokens = scope.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    const compositionReadOnlyRequest = requestedScopeTokens.length > 0
      && requestedScopeTokens.every((value) =>
        /^organization\/Composition\.(?:r|rs)\?/i.test(value));
    const sharedProjection = compositionReadOnlyRequest
      ? deriveGrantedSmartScopes(rules as ConsentRule[], {
          requestedScopes: requestedScopeTokens,
          actor: {
            actorKind: actor.sub.includes(':family:') ? 'related-person' : 'professional',
            did: actor.sub,
            aliases: Array.from(actorSubjectAliases),
            email: memberLicense?.issuedToEmail
              || (actor.identifier?.includes('@') ? actor.identifier : undefined),
            phone: memberLicense?.issuedToPhone,
            organizationDid: actor.organization,
            jurisdiction: job.jurisdiction,
          },
          actorRole: actor.role,
          purpose,
        })
      : undefined;
    const evaluation = sharedProjection
      ? {
          allowed: sharedProjection.grantedScopes.length > 0,
          missingSections: sharedProjection.deniedSections,
          missingResourceTypes: [] as string[],
        }
      : this.evaluateRequestedConsent({
          rules,
          subject,
          actor,
          purpose,
          requestedPermissions,
          jurisdiction: job.jurisdiction,
          actorSubjectAliases,
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
    if (sharedProjection) {
      grantedScope = sharedProjection.grantedScopes.join(' ');
    }

    const lifetimeSeconds = Math.max(1, Math.min(3600, body.expires_in || 300));
    const tokenType = body.token_type || 'Bearer';

    const issuerVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);

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
      scope: grantedScope,
      iat: now,
      nbf: now,
      exp: now + lifetimeSeconds,
      acr: accessProof.acr,
      amr: accessProof.amr,
      vp_hash: accessProof.vpHash,
      ledger_verified: accessProof.ledgerVerified,
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
        scope: grantedScope,
        subject,
        ledger_verified: accessProof.ledgerVerified,
      },
    };
  }

  private async resolveAccessProof(params: {
    acrValues: string[];
    actorOrganizationDid?: string;
    issuerDid: string;
    purpose?: string;
    requestedCapabilities: string[];
    vpToken?: string;
    presentationSubmission?: any;
    bearerPayload?: Record<string, any>;
  }): Promise<AccessProofResult> {
    if (params.vpToken) {
      const clearingResult = await this.clearingHouseService.verifyVpToken({
        vpToken: params.vpToken,
        presentationSubmission: params.presentationSubmission,
        acrValues: params.acrValues,
      });

      if (!params.acrValues.includes(clearingResult.acr)) {
        throw new ManagerError('Clearing House returned an unexpected acr value.', IssueType.Forbidden);
      }

      return {
        mode: 'vp_token',
        acr: clearingResult.acr,
        amr: Array.isArray(clearingResult.amr) ? clearingResult.amr : [],
        vpHash: clearingResult.vpHash,
        ledgerVerified: clearingResult.ledgerVerified,
      };
    }

    return this.resolveExternalResearchBearerProof(params);
  }

  /**
   * Resolves the accepted member license that binds the authenticated Firebase
   * actor, subject and relationship. Its verified email/telephone may then be
   * used for Consent matching; the privacy-preserving VP aliases stay hashed.
   */
  private async getActiveMemberLicense(input: {
    tenantVaultId: string;
    subject: string;
    actorIdentifier?: string;
    actorRole?: string;
  }): Promise<DeviceLicense | undefined> {
    const actorIdentifier = String(input.actorIdentifier || '').trim();
    const actorRole = String(input.actorRole || '').trim().toLowerCase();
    if (!actorIdentifier || !actorRole) return undefined;
    const documents = await this.vaultRepository.getContainersInSection<any>(
      input.tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    return (documents || []).map((document: any) =>
      document?.content as DeviceLicense & Record<string, unknown> | undefined
    ).find((license) => {
      return license?.status === 'active'
        && String(license.subjectId || '').replace(/^firebase:/, '') === actorIdentifier.replace(/^firebase:/, '')
        && String(license.authorizedSubjectDid || '').trim() === input.subject
        && String(license.issuedToRole || '').trim().toLowerCase() === actorRole;
    });
  }

  private async validateClientAssertion(params: {
    body: TokenRequestBody;
    clientId?: string;
    issuerDid: string;
    tenantVaultId: string;
    requestIssuerDid?: string;
  }): Promise<void> {
    const clientAssertion = params.body.client_assertion?.trim();
    const clientAssertionType = params.body.client_assertion_type?.trim();
    if (!clientAssertion && !clientAssertionType) {
      return;
    }

    if (!clientAssertion) {
      throw new ManagerError("Missing 'client_assertion' in token request body.", IssueType.Required);
    }
    if (!clientAssertionType) {
      throw new ManagerError("Missing 'client_assertion_type' in token request body.", IssueType.Required);
    }
    if (!this.isSupportedClientAssertionType(clientAssertionType)) {
      throw new ManagerError(`Unsupported client_assertion_type '${clientAssertionType}'.`, IssueType.NotSupported);
    }

    const payload = await this.verifyClientAssertionSignature(clientAssertion, params.clientId, params.tenantVaultId);
    const assertionClientId = String(payload?.iss || '').trim();
    if (!assertionClientId) {
      throw new ManagerError('client_assertion must include iss.', IssueType.Required);
    }
    if (params.clientId && assertionClientId !== params.clientId) {
      throw new ManagerError('client_assertion iss must match body.client_id.', IssueType.Forbidden);
    }

    const assertionSub = String(payload?.sub || '').trim();
    if (assertionSub && assertionSub !== assertionClientId) {
      throw new ManagerError('client_assertion sub must match client identity.', IssueType.Forbidden);
    }

    if (params.requestIssuerDid && assertionClientId !== params.requestIssuerDid) {
      throw new ManagerError('client_assertion client identity must match request issuer.', IssueType.Forbidden);
    }

    const audience = this.readAudienceString(payload?.aud);
    if (!audience) {
      throw new ManagerError('client_assertion must include aud.', IssueType.Required);
    }
    if (audience !== params.issuerDid && !audience.includes('/identity/openid/smart/token')) {
      throw new ManagerError('client_assertion aud does not target this SMART token endpoint.', IssueType.Forbidden);
    }
  }

  private isSupportedClientAssertionType(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
      || normalized === 'private_key_jwt'
      || normalized === 'client_assertion';
  }

  private async verifyClientAssertionSignature(
    compact: string,
    clientId: string | undefined,
    tenantVaultId: string,
  ): Promise<Record<string, any>> {
    const header = decodeProtectedHeader(compact);
    const alg = String(header.alg || '').trim();
    if (!alg || alg.toLowerCase() === 'none') {
      throw new ManagerError('client_assertion must be signed with a supported algorithm.', IssueType.Security);
    }

    const jwks = await this.resolveClientAssertionJwks(compact, header, clientId, tenantVaultId, alg);
    let lastError = '';
    for (const jwk of jwks) {
      try {
        const keyLike = await importJWK(jwk as JWK, alg);
        const { payload } = await compactVerify(compact, keyLike);
        return JSON.parse(Content.bytesToStringUTF8(payload));
      } catch (error: any) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new ManagerError(
      `Invalid client_assertion signature${lastError ? `: ${lastError}` : ''}`,
      IssueType.Security,
    );
  }

  private async resolveClientAssertionJwks(
    compact: string,
    header: Record<string, any>,
    clientId: string | undefined,
    tenantVaultId: string,
    alg: string,
  ): Promise<Record<string, any>[]> {
    const resolved: Record<string, any>[] = [];
    const embedded = header.jwk;
    if (embedded && typeof embedded === 'object') {
      resolved.push(embedded as Record<string, any>);
    }

    if (clientId) {
      const deviceProfileDoc = await this.vaultRepository.get<any>(
        tenantVaultId,
        clientId,
        getEnvSectionId('device-profiles'),
      );
      if (deviceProfileDoc) {
        const profile = this.kmsService.unprotectConfidentialData
          ? await this.kmsService.unprotectConfidentialData<any>(deviceProfileDoc, tenantVaultId).catch(() => undefined)
          : deviceProfileDoc?.content;
        const keys = Array.isArray(profile?.jwks?.keys) ? profile.jwks.keys : [];
        const kid = String(header.kid || '').trim();
        for (const key of keys) {
          if (!key || typeof key !== 'object') continue;
          if (kid && String((key as any).kid || '').trim() && String((key as any).kid).trim() !== kid) continue;
          if (String((key as any).alg || '').trim() && String((key as any).alg).trim() !== alg) continue;
          resolved.push(key as Record<string, any>);
        }
      }
    }

    if (resolved.length === 0) {
      throw new ManagerError(
        `Could not resolve verification key material for client_assertion${clientId ? ` client_id='${clientId}'` : ''}.`,
        IssueType.NotFound,
      );
    }
    return resolved;
  }

  private resolveExternalResearchBearerProof(params: {
    acrValues: string[];
    actorOrganizationDid?: string;
    issuerDid: string;
    purpose?: string;
    requestedCapabilities: string[];
    bearerPayload?: Record<string, any>;
  }): AccessProofResult {
    const purpose = String(params.purpose || '').trim().toUpperCase();
    if (purpose !== 'RESEARCH') {
      throw new ManagerError("Missing 'vp_token' in token request body.", IssueType.Required);
    }

    if (!params.actorOrganizationDid || params.actorOrganizationDid === params.issuerDid) {
      throw new ManagerError("Missing 'vp_token' in token request body.", IssueType.Required);
    }

    const payload = params.bearerPayload;
    if (!payload || typeof payload !== 'object') {
      throw new ManagerError(
        'Missing validated external research Bearer token metadata for SMART token request.',
        IssueType.Required,
      );
    }

    const trustedIssuers = this.readTrustedExternalResearchIssuers();
    const externalIssuer = this.readFirstString(payload, ['iss', 'issuer']);
    if (!externalIssuer || !trustedIssuers.has(externalIssuer)) {
      throw new ManagerError('External research Bearer token issuer is not trusted.', IssueType.Forbidden);
    }

    const consumerOrganizationDid = this.readFirstString(payload, [
      'consumer_organization',
      'consumerOrganizationDid',
      'organization',
      'organizationDid',
      'org',
    ]);
    if (!consumerOrganizationDid || consumerOrganizationDid !== params.actorOrganizationDid) {
      throw new ManagerError('External research Bearer token consumer organization does not match requester.', IssueType.Forbidden);
    }

    const providerOrganizationDid = this.readFirstString(payload, [
      'provider_organization',
      'providerOrganizationDid',
    ]) || this.readAudienceString(payload.aud);
    if (!providerOrganizationDid || providerOrganizationDid !== params.issuerDid) {
      throw new ManagerError('External research Bearer token provider does not match issuer tenant.', IssueType.Forbidden);
    }

    const purposes = this.readStringValues(payload, ['purpose', 'purposes']);
    if (!purposes.some((value) => value.toUpperCase() === purpose)) {
      throw new ManagerError('External research Bearer token purpose does not match request.', IssueType.Forbidden);
    }

    const grantedCapabilities = this.readGrantedCapabilities(payload);
    if (!params.requestedCapabilities.every((capability) => grantedCapabilities.includes(capability))) {
      throw new ManagerError('External research Bearer token capabilities do not cover requested scope.', IssueType.Forbidden);
    }

    const externalAcr = this.readFirstString(payload, ['acr']);
    const acr = externalAcr && params.acrValues.includes(externalAcr)
      ? externalAcr
      : params.acrValues[0];

    return {
      mode: 'external_research_bearer',
      acr,
      amr: this.readStringValues(payload, ['amr']).length
        ? this.readStringValues(payload, ['amr'])
        : ['external_bearer', 'data_access_token'],
      ledgerVerified: typeof payload.ledger_verified === 'boolean'
        ? payload.ledger_verified
        : true,
    };
  }

  private readTrustedExternalResearchIssuers(): Set<string> {
    const configured = String(process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return new Set(configured);
  }

  /**
   * Reads the fail-closed allowlist of authorities that may bind two public
   * DIDs belonging to the same individual.
   *
   * This is an issuer policy after VP/VC proof verification. It never turns a
   * DID Document `alsoKnownAs` value or a physical support DID into an
   * authorization identity.
   */
  private readTrustedSubjectIdentityBindingIssuers(): string[] {
    return Array.from(new Set(
      String(process.env.SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS || '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.startsWith('did:web:')),
    ));
  }

  private readFirstString(source: Record<string, any>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private readAudienceString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim());
      if (typeof first === 'string') return first.trim();
    }
    return undefined;
  }

  private readStringValues(source: Record<string, any>, keys: string[]): string[] {
    const values: string[] = [];
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string') {
        values.push(
          ...value.split(/\s+/).map((entry) => entry.trim()).filter(Boolean),
        );
        continue;
      }
      if (Array.isArray(value)) {
        values.push(
          ...value
            .filter((entry) => typeof entry === 'string')
            .map((entry) => String(entry).trim())
            .filter(Boolean),
        );
      }
    }
    return Array.from(new Set(values));
  }

  private readGrantedCapabilities(source: Record<string, any>): string[] {
    const rawValues = this.readStringValues(source, ['scope', 'scopes', 'capability', 'capabilities']);
    const expanded = new Set<string>();
    for (const value of rawValues) {
      expanded.add(value);
      const queryIndex = value.indexOf('?');
      if (queryIndex > 0) {
        expanded.add(value.slice(0, queryIndex));
      }
    }
    return Array.from(expanded);
  }

  private extractPinnedSubjectAndSections(scope: string): { subject: string; sections: string[] } {
    const scopes = scope.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const forbiddenPatientScopes = scopes.filter((s) => {
      const normalized = s.toLowerCase();
      return normalized.startsWith('patient/composition.')
        || normalized.startsWith('patient/researchsubject.');
    });
    if (forbiddenPatientScopes.length > 0) {
      throw new ManagerError(
        'SMART token requests must use organization-scoped root capabilities. patient/* scopes are not accepted.',
        IssueType.NotSupported,
      );
    }

    const rootScopes = scopes.filter((s) => {
      const normalized = s.toLowerCase();
      return normalized.startsWith('organization/composition.')
        || normalized.startsWith('organization/researchsubject.');
    });
    if (rootScopes.length === 0) {
      throw new ManagerError('Missing required root scope: organization/Composition.<cruds>?subject=... or organization/ResearchSubject.<cruds>?subject=...', IssueType.Required);
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

  private parseRequestedScopePermissions(scope: string): ParsedPermission[] {
    const requested: ParsedPermission[] = [];
    for (const token of scope.split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      if (!token.toLowerCase().startsWith('organization/') && !token.toLowerCase().startsWith('patient/')) continue;
      const parsed = this.parsePermissionExpression(token, { allowLegacySectionList: false });
      const subject = parsed.filters.subject;
      if (subject) delete parsed.filters.subject;
      requested.push(parsed);
    }
    return requested;
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

  private extractRequestedCapabilities(scope: string): string[] {
    return Array.from(new Set(
      scope
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.split('?', 1)[0]?.trim())
        .filter((value): value is string => Boolean(value))
        .filter((value) => value.toLowerCase().startsWith('organization/')),
    ));
  }

  private evaluateRequestedConsent(input: {
    rules: any[];
    subject: string;
    actor: ReturnType<typeof parseActorFromSub>;
    purpose?: string;
    requestedPermissions: ParsedPermission[];
    jurisdiction: string;
    actorSubjectAliases?: ReadonlySet<string>;
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

    const requestedPermissions = input.requestedPermissions.length > 0
      ? input.requestedPermissions
      : [this.parsePermissionExpression('organization/Composition.rs?section=*', { allowLegacySectionList: false })];

    for (const requestedPermission of requestedPermissions) {
      const candidates = (input.rules || [])
        .filter((rule) => String(getClaimValue<string>(rule, 'Consent.subject') || '').trim() === input.subject)
        .filter((rule) => this.isRuleTimeActive(rule))
        .filter((rule) => this.matchesRulePurpose(rule, input.purpose))
        .filter((rule) => this.matchesRuleRole(rule, normalizedActorRole, actorEmail))
        .filter((rule) => this.matchesRulePermission(rule, requestedPermission))
        .map((rule) => {
          const match = this.resolveRuleMatchKind(
            rule,
            input.actor,
            actorEmail,
            normalizedJurisdiction,
            input.actorSubjectAliases,
          );
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
        const requestedSections = requestedPermission.filters.section || [];
        if (requestedPermission.resourceType === 'Composition' && requestedSections.length > 0 && !requestedSections.includes('*')) {
          missingSections.push(...requestedSections);
        } else {
          missingResourceTypes.push(requestedPermission.resourceType);
        }
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

  private matchesRulePermission(rule: any, requestedPermission: ParsedPermission): boolean {
    const rawAction = String(getClaimValue<string>(rule, 'Consent.action') || '').trim();
    const parsedRulePermissions = this.parseStoredRulePermissions(rawAction);
    if (parsedRulePermissions.length === 0) {
      return requestedPermission.resourceType === 'Composition'
        && (!requestedPermission.filters.section || requestedPermission.filters.section.includes('*'));
    }

    return parsedRulePermissions.some((rulePermission) => this.rulePermissionCoversRequest(rulePermission, requestedPermission));
  }

  private parseStoredRulePermissions(rawAction: string): ParsedPermission[] {
    const value = rawAction.trim();
    if (!value) return [];

    const tokens = this.isCanonicalPermissionExpression(value)
      ? value.split(/\s+/).map((part) => part.trim()).filter(Boolean)
      : [value];

    return tokens.map((token) => this.parsePermissionExpression(token, { allowLegacySectionList: true }));
  }

  private isCanonicalPermissionExpression(value: string): boolean {
    return /^(?:organization\/|patient\/)?[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z]+)(?:\?|$)/.test(value);
  }

  private parsePermissionExpression(
    value: string,
    options: Readonly<{ allowLegacySectionList: boolean }>,
  ): ParsedPermission {
    const raw = String(value || '').trim();
    if (!raw) {
      return {
        raw,
        capability: 'Composition.rs',
        resourceType: 'Composition',
        filters: {},
      };
    }

    if (options.allowLegacySectionList && !this.isCanonicalPermissionExpression(raw)) {
      const sections = raw
        .split(',')
        .map((item) => normalizeCodeSystemAndValue(item.trim()))
        .filter(Boolean);
      return {
        raw,
        capability: 'Composition.rs',
        resourceType: 'Composition',
        filters: sections.length > 0 ? { section: sections } : {},
      };
    }

    const withoutPrefix = raw.replace(/^(organization|patient)\//i, '');
    const [head, queryString = ''] = withoutPrefix.split('?', 2);
    const capability = head.trim();
    const resourceType = capability.split('.', 1)[0]?.trim() || capability;
    const params = new URLSearchParams(queryString);
    const filters: Record<string, string[]> = {};
    for (const [key, rawValue] of params.entries()) {
      const values = String(rawValue || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => key === 'section' ? normalizeCodeSystemAndValue(item) : item);
      if (values.length > 0) filters[key] = values;
    }

    return {
      raw,
      capability,
      resourceType,
      filters,
    };
  }

  private rulePermissionCoversRequest(rulePermission: ParsedPermission, requestedPermission: ParsedPermission): boolean {
    if (rulePermission.resourceType !== requestedPermission.resourceType) return false;

    const requestedFilterKeys = Object.keys(requestedPermission.filters);
    for (const key of requestedFilterKeys) {
      const requestedValues = requestedPermission.filters[key] || [];
      if (requestedValues.length === 0) continue;
      if (requestedValues.includes('*')) continue;

      const normalizedRequestedValues = requestedValues.map((value) => key === 'section' ? normalizeCodeSystemAndValue(value) : value);
      const ruleValues = (rulePermission.filters[key] || []).map((value) => key === 'section' ? normalizeCodeSystemAndValue(value) : value);
      if (ruleValues.length === 0) return false;
      if (ruleValues.includes('*')) continue;
      if (!normalizedRequestedValues.every((value) => ruleValues.includes(value))) return false;
    }

    return true;
  }

  private resolveRuleMatchKind(
    rule: any,
    actor: ReturnType<typeof parseActorFromSub>,
    actorEmail: string | undefined,
    jurisdiction: string,
    actorSubjectAliases?: ReadonlySet<string>,
  ): 'direct' | 'organization' | 'jurisdiction' | undefined {
    const ruleActor = String(getClaimValue<string>(rule, 'Consent.actor-identifier') || '').trim();
    if (!ruleActor) return undefined;

    if (actorEmail && ruleActor.toLowerCase() === actorEmail) return 'direct';
    if (ruleActor === actor.sub) return 'direct';
    if (actorSubjectAliases?.has(ruleActor)) return 'direct';

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
