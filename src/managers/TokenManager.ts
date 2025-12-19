// src/managers/TokenManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ManagerError } from '../models/errors/manager-error';
import { IssueType } from '../models/fhir/codes';
import { TenantsCacheManager } from './TenantsCacheManager';
import { Content } from '../utils/content';

/**
 * Manages the business logic for creating and signing system-level tokens,
 * such as the `initial_access_token`. Its sole responsibility is token creation.
 * It does not perform any validation of inputs.
 */
export class TokenManager {
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;

  constructor(
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager
  ) {
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  /**
   * Creates a short-lived `initial_access_token` for the DCR flow.
   * @param claims - The claims to include in the token, e.g., `sub`, `jti`, `act_code`.
   * @param lifetimeSeconds - The lifetime of the token in seconds.
   * @returns A promise that resolves to the compact JWT string.
   */
  public async createInitialAccessToken(claims: any, lifetimeSeconds: number): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Get Host DID for the 'iss' claim
    const hostDidDoc = await this.tenantsCacheManager.getDidDocument('host');
    const hostDid = hostDidDoc?.id;
    if (!hostDid) {
        throw new ManagerError('Could not resolve host DID. System not properly configured.', IssueType.Exception);
    }

    // 2. Get Host signing key for the 'kid' in the header
    const hostSignKey = await this.kmsService.getPublicVerificationKey('host');
    if (!hostSignKey || !hostSignKey.kid) {
        throw new ManagerError('Could not resolve host signing key.', IssueType.Exception);
    }

    // 3. Construct the JWT Header and Payload
    const jwtHeader = { alg: 'ML-DSA-44', typ: 'JWT', kid: hostSignKey.kid };
    const jwtPayload = {
        ...claims, // Spread the input claims first
        iss: hostDid,
        aud: 'urn:gateway:dcr',
        exp: now + lifetimeSeconds,
        nbf: now,
        scope: 'dcr:register',
    };
    
    // 4. Manually construct the parts to be signed
    const encodedHeader = Content.stringToBase64Url(JSON.stringify(jwtHeader));
    const encodedPayload = Content.stringToBase64Url(JSON.stringify(jwtPayload));
    const dataToSign = Content.stringToBytesUTF8(`${encodedHeader}.${encodedPayload}`);

    // 5. Call KMS to get the signature
    const jwsObject = await this.kmsService.signWithManagedKey(dataToSign, 'host');
    const signature = jwsObject.signatures[0].signature;
    
    // 6. Assemble the final compact JWT
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }
}
