// src/managers/IdentityTokenManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { randomUUID } from 'crypto';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { AppAuthorizationManager } from './AppAuthorizationManager';
import { TokenManager } from './TokenManager';
import { federateOidcIdTokenToFirebaseCustomToken } from '../auth/OidcFederationService';

type TokenExchangeBody = {
  subject_token?: string;
};

type FirebaseCustomTokenBody = {
  provider?: string;
  id_token?: string;
};

export class IdentityTokenManager implements IJobProcessor {
  constructor(
    private readonly appAuthManager: AppAuthorizationManager,
    private readonly tokenManager: TokenManager,
  ) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid;
    if (!thid) throw new ManagerError('Missing thid.', IssueType.Required);

    const action = String(job.action || '');
    if (action === '_exchange') return this.processInitialAccessTokenExchange(job);
    if (action === '_custom') return this.processFirebaseCustomToken(job);

    throw new ManagerError(`Unsupported action for Token: ${action}`, IssueType.NotSupported);
  }

  private async processInitialAccessTokenExchange(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content!.thid!;

    const bearer = (job.content as any)?.meta?.bearer?.token as string | undefined;
    const idToken = bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : undefined;
    if (!idToken) {
      throw new ManagerError('Missing Bearer token.', IssueType.Security);
    }

    const verificationResult = await this.appAuthManager.verifyIdToken(idToken);
    const { sub: userId, tenant_id: tenantIdFromToken } = (verificationResult.payload || {}) as any;
    if (!userId) {
      throw new ManagerError('Missing sub claim in id_token.', IssueType.Security);
    }
    if (!tenantIdFromToken) {
      throw new ManagerError('tenant_id claim missing from id_token.', IssueType.BusinessRule);
    }

    const body = (job.content?.body || {}) as TokenExchangeBody;
    const activationCode = body.subject_token;
    if (!activationCode) {
      throw new ManagerError('Missing subject_token in request body.', IssueType.Value);
    }

    await this.appAuthManager.verifyAndConsumeActivationCode(activationCode, tenantIdFromToken, job.sector as string);

    const tokenLifetime = 60;
    const claims = {
      sub: userId,
      jti: randomUUID(),
      act_code: activationCode,
      tenant_id: tenantIdFromToken,
      scope: 'dcr:register',
    };
    const accessToken = await this.tokenManager.createInitialAccessToken(claims, tokenLifetime);

    return {
      jti: job.content?.jti || thid,
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      type: 'application/json',
      body: {
        initial_access_token: accessToken,
        token_type: 'Bearer',
        expires_in: tokenLifetime,
        scope: 'dcr:register',
      },
    };
  }

  private async processFirebaseCustomToken(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content!.thid!;
    const body = (job.content?.body || {}) as FirebaseCustomTokenBody;
    const provider = body.provider;
    const idToken = body.id_token;
    if (provider !== 'eidas') {
      throw new ManagerError('Unsupported provider. Expected "eidas".', IssueType.Value);
    }
    if (!idToken || typeof idToken !== 'string') {
      throw new ManagerError('Missing id_token in request body.', IssueType.Value);
    }

    const result = await federateOidcIdTokenToFirebaseCustomToken({ provider, idToken });

    return {
      jti: job.content?.jti || thid,
      thid,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      type: 'application/json',
      body: {
        firebase_custom_token: result.firebaseCustomToken,
        provider: result.provider,
        subject: result.subject,
        ...(result.email ? { email: result.email } : {}),
      },
    };
  }
}

