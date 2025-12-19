// src/managers/AppAuthorizationManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ITokenVerifier, VerificationResult } from '../auth/ITokenVerifier';
import { IKmsService } from '../crypto/interfaces/IKmsService';
import { ICryptography } from '../crypto/interfaces/ICryptography';
import { ManagerError } from '../models/errors/manager-error';
import { IssueType } from '../models/fhir/codes';
import { DeviceLicense } from '../models/device-license';
import { ConfidentialStorageDoc } from '../models/confidential-storage';
import { getTenantVaultId } from '../utils/tenant';
import { Content } from '../utils/content';
import { stringToBytesUTF8 } from '../utils/string-convert';

/**
 * Manages application-specific authorization logic, such as validating tokens and codes.
 * This manager is responsible for answering the question "Is this credential valid?".
 * It does not create tokens. This is separate from the FHIR-specific IAuthorizationManager.
 */
export class AppAuthorizationManager {
  private vaultRepository: IVaultRepository;
  private tokenVerifier: ITokenVerifier;
  private kmsService: IKmsService;
  private cryptographyService: ICryptography;

  constructor(
    vaultRepository: IVaultRepository,
    tokenVerifier: ITokenVerifier,
    kmsService: IKmsService,
    cryptographyService: ICryptography,
  ) {
    this.vaultRepository = vaultRepository;
    this.tokenVerifier = tokenVerifier;
    this.kmsService = kmsService;
    this.cryptographyService = cryptographyService;
  }

  /**
   * Verifies an id_token from an external provider.
   * @param idToken The token to verify.
   * @returns The verification result.
   * @throws {ManagerError} If verification fails.
   */
  public async verifyIdToken(idToken: string): Promise<VerificationResult> {
    const result = await this.tokenVerifier.verify(idToken);
    if (!result.valid) {
      throw new ManagerError(`ID token is invalid: ${result.error}`, IssueType.Security);
    }
    return result;
  }

  /**
   * Verifies an activation code, and if valid, marks it as 'active' to consume it.
   * This logic assumes the code was found in the URL and passed to the DCR handler.
   * @param code The activation code.
   * @param tenantId The tenant associated with the code.
   * @param sector The sector associated with the tenant.
   * @returns An object with `valid: true` and the license if successful.
   * @throws {ManagerError} If the code is invalid, already used, or expired.
   */
  public async verifyAndConsumeActivationCode(code: string, tenantId: string, sector: string): Promise<{ valid: true; license: DeviceLicense; }> {
    const now = Math.floor(Date.now() / 1000);
    const vaultId = getTenantVaultId(sector, tenantId);

    // Note: Activation codes are not the primary ID of the license document.
    // We need a way to query by the `activationCode` field.
    // This assumes the repository's query method can handle this.
    const queryResults = await this.vaultRepository.query(vaultId, { activationCode: code }) as ConfidentialStorageDoc[];
    
    if (!queryResults || queryResults.length === 0) {
      throw new ManagerError('Activation code not found or invalid.', IssueType.NotFound);
    }
    if (queryResults.length > 1) {
      // This case indicates a serious data integrity issue.
      throw new ManagerError('Multiple licenses found for the same activation code.', IssueType.Exception);
    }
    
    const licenseDoc = queryResults[0];
    const license = licenseDoc.content as DeviceLicense;

    // A license must be 'issued' to a user before it can be activated.
    if (license.status !== 'issued') {
      throw new ManagerError('License is not in an activatable state. It might have already been activated or was never issued.', IssueType.Conflict);
    }
    if (license.exp < now) {
      throw new ManagerError('Activation code has expired.', IssueType.BusinessRule);
    }

    // Mark as active and update
    license.status = 'active';
    license.activatedAt = now;
    licenseDoc.sequence++;
    await this.vaultRepository.put(vaultId, [licenseDoc], 'device-licenses');

    return { valid: true, license };
  }

  /**
   * Verifies the signature and claims of an initial_access_token issued by the host.
   * @param token The token string to verify.
   * @returns The claims of the token if valid.
   * @throws {ManagerError} If the token is invalid.
   */
  public async verifyInitialAccessToken(token: string): Promise<any> {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) {
        throw new ManagerError('Invalid JWT format for initial_access_token.', IssueType.Security);
    }

    // 1. Verify Signature
    const hostSignKey = await this.kmsService.getPublicVerificationKey('host');
    if (!hostSignKey) {
      throw new ManagerError('Host signing key not found, cannot verify token.', IssueType.Exception);
    }
    const bytesToVerify = stringToBytesUTF8(`${header}.${payload}`);
    const isValid = await this.cryptographyService.verifyDetachedJws(bytesToVerify, signature, hostSignKey);

    if (!isValid) {
      throw new ManagerError('Invalid signature for initial_access_token.', IssueType.Security);
    }

    // 2. Verify Claims
    const claims = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(payload)));
    if (claims.scope !== 'dcr:register') {
      throw new ManagerError("Token scope must be 'dcr:register'.", IssueType.Forbidden);
    }
    if (claims.exp < Math.floor(Date.now() / 1000)) {
      throw new ManagerError('Initial access token has expired.', IssueType.Forbidden);
    }

    return claims;
  }
}
