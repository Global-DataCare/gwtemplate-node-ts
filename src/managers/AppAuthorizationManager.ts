// src/managers/AppAuthorizationManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ITokenVerifier, VerificationResult } from '../auth/ITokenVerifier';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { getTenantVaultId } from '../utils/tenant';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { getEnvSectionId } from '../utils/section-env';
import { compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { normalizeSameAsHash, normalizeTelephoneHash } from 'gdc-common-utils-ts/utils/same-as';
import { normalizeIndexedEmail, normalizeIndexedPhone } from '../utils/indexed-contact';
import { DEFAULT_LICENSE_DEVICE_ALLOWANCE } from '../constants/domain';

type ActivationActor = Readonly<{
  subject: string;
  email?: string;
  emailVerified?: boolean;
  phone?: string;
}>;

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
   * Verifies a generic HTTP Bearer token accepted by controller-facing routes.
   *
   * Current policy:
   * - accept a regular OIDC/Firebase `id_token`, or
   * - accept one compact JWT VP (`controller proof bearer`) signed by the
   *   controller wallet key and carrying one embedded public JWK.
   *
   * The latter intentionally keeps lifecycle/control-plane calls separate from
   * SMART access tokens while avoiding a dependency on email-login proof when
   * the controller already presents ICA-backed wallet proof.
   */
  public async verifyBearerToken(token: string): Promise<VerificationResult> {
    try {
      return await this.verifyIdToken(token);
    } catch (idTokenError: any) {
      try {
        return await this.verifyControllerProofBearer(token);
      } catch (vpError: any) {
        const idMessage = idTokenError instanceof Error ? idTokenError.message : String(idTokenError || 'verification failed');
        const vpMessage = vpError instanceof Error ? vpError.message : String(vpError || 'verification failed');
        throw new ManagerError(
          `Bearer token is invalid: ${idMessage}; controller proof bearer verification also failed: ${vpMessage}`,
          IssueType.Security,
        );
      }
    }
  }

  /**
   * Authorizes one installation with an activation code. The professional seat
   * remains active and can register additional installations up to maxDevices.
   * This logic assumes the code was found in the URL and passed to the DCR handler.
   * @param code The activation code.
   * @param tenantId The tenant associated with the code.
   * @param sector The sector associated with the tenant.
   * @returns An object with `valid: true` and the license if successful.
   * @throws {ManagerError} If the code is invalid, already used, or expired.
   */
  public async verifyAndConsumeActivationCode(
    code: string,
    tenantId: string,
    sector: string,
    authenticatedIdentity?: string | ActivationActor,
    clientInstanceId?: string,
  ): Promise<{ valid: true; license: DeviceLicense; }> {
    const now = Math.floor(Date.now() / 1000);
    const vaultId = getTenantVaultId(sector, tenantId);

    // Activation codes are not the primary ID of the license document.
    // Prefer a secure indexed lookup (HMAC-protected) and fall back to a scan in memory/dev.
    const protectedName = await this.kmsService.getHmacBase64Url('activationCode', vaultId);
    const protectedValue = await this.kmsService.getHmacBase64Url(code, vaultId);

    let licenseDocs: ConfidentialStorageDoc[] = [];
    try {
      licenseDocs = (await this.vaultRepository.query(vaultId, {
        sectionId: getEnvSectionId('device-licenses'),
        where: [{ name: protectedName, value: protectedValue }],
      })) as unknown as ConfidentialStorageDoc[];
    } catch {
      // Ignore: some repository implementations may not support query for this use case yet.
      licenseDocs = [];
    }

    if (!licenseDocs || licenseDocs.length === 0) {
      // Fallback scan (works for in-memory/dev repositories).
      const all = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, getEnvSectionId('device-licenses'));
      licenseDocs = all.filter((doc) => (doc.content as any)?.activationCode === code);
    }

    if (!licenseDocs || licenseDocs.length === 0) {
      throw new ManagerError('Activation code not found or invalid.', IssueType.NotFound);
    }
    if (licenseDocs.length > 1) {
      throw new ManagerError('Multiple licenses found for the same activation code.', IssueType.Exception);
    }

    const licenseDoc = licenseDocs[0];
    const license = licenseDoc.content as DeviceLicense & Record<string, any>;

    if (license.status !== 'issued' && license.status !== 'active') {
      throw new ManagerError('License is not in an activatable or active multi-device state.', IssueType.Conflict);
    }
    if (license.exp < now) {
      throw new ManagerError('Activation code has expired.', IssueType.BusinessRule);
    }

    const identity = typeof authenticatedIdentity === 'string'
      ? { subject: authenticatedIdentity }
      : authenticatedIdentity;
    const email = normalizeIndexedEmail(String(identity?.email || ''));
    const phone = normalizeIndexedPhone(String(identity?.phone || ''));
    const issuedEmail = normalizeIndexedEmail(String(license.issuedToEmail || ''));
    const issuedPhone = normalizeIndexedPhone(String(license.issuedToPhone || ''));
    if (!issuedEmail && !issuedPhone) {
      throw new ManagerError('License has no canonical email or phone actor contact.', IssueType.BusinessRule);
    }
    if (issuedEmail) {
      if (!email || email !== issuedEmail) {
        throw new ManagerError('Activation identity does not match the licensed email.', IssueType.Forbidden);
      }
      if (identity?.emailVerified === false) {
        throw new ManagerError('Activation requires a verified licensed email.', IssueType.Forbidden);
      }
    } else if (!phone || phone !== issuedPhone) {
      throw new ManagerError('Activation identity does not match the licensed phone.', IssueType.Forbidden);
    }
    const actor = issuedEmail
      ? normalizeSameAsHash(issuedEmail)
      : normalizeTelephoneHash(issuedPhone!);
    if (license.status === 'active') {
      const legacyActor = Boolean(license.activatedBy
        && !/^urn:multibase:z[^:]+$/.test(String(license.activatedBy)));
      const canMigrateLegacyActor = legacyActor;
      if (license.activatedBy && !canMigrateLegacyActor && license.activatedBy !== actor) {
        throw new ManagerError('Active seat belongs to a different authenticated user.', IssueType.Forbidden);
      }
      const activeBindings = this.readActiveDeviceBindings(license);
      const sameInstallation = clientInstanceId && activeBindings.some((binding) =>
        binding.clientInstanceId === clientInstanceId);
      const allowance = this.readDeviceAllowance(license);
      if (!sameInstallation && activeBindings.length >= allowance) {
        throw new ManagerError(`Device allowance exhausted for this license (${activeBindings.length}/${allowance}).`, IssueType.Conflict);
      }
      // Migration for active legacy seats created before activatedBy/maxDevices.
      // The first authenticated reuse claims the seat; later reuses must match.
      if (!license.activatedBy || canMigrateLegacyActor) {
        license.activatedBy = actor;
        license.maxDevices = allowance;
        licenseDoc.sequence++;
        await this.vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));
      }
    } else {
      license.status = 'active';
      license.activatedAt = now;
      license.activatedBy = actor;
      license.maxDevices = this.readDeviceAllowance(license);
      licenseDoc.sequence++;
      await this.vaultRepository.put(vaultId, [licenseDoc], getEnvSectionId('device-licenses'));
    }

    return { valid: true, license };
  }

  private readDeviceAllowance(license: DeviceLicense & Record<string, any>): number {
    const value = Number(license.maxDevices);
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_LICENSE_DEVICE_ALLOWANCE;
  }

  private readActiveDeviceBindings(license: DeviceLicense & Record<string, any>): any[] {
    if (Array.isArray(license.deviceBindings)) {
      return license.deviceBindings.filter((binding: any) => binding.status === 'active');
    }
    const clientId = String(license.deviceId || '').trim();
    if (!clientId) return [];
    return [{ clientId, clientInstanceId: license.deviceInfo?.clientInstanceId || clientId, status: 'active' }];
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
    const hostSignKey = await this.kmsService.getPublicVerificationKey('host', undefined, 'comm_sig');
    if (!hostSignKey) {
      throw new ManagerError('Host signing key not found, cannot verify token.', IssueType.Exception);
    }
    const isValid = await this.cryptographyService.verifyJws(
      { protected: header, payload, signature },
      hostSignKey,
    );

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

  private async verifyControllerProofBearer(token: string): Promise<VerificationResult> {
    const compact = String(token || '').trim();
    const parts = compact.split('.');
    if (parts.length !== 3) {
      throw new ManagerError('Controller proof bearer must be a compact JWT (JWS).', IssueType.Security);
    }

    const header = decodeProtectedHeader(compact);
    const alg = String(header.alg || '').trim();
    if (!alg || alg.toLowerCase() === 'none') {
      throw new ManagerError('Controller proof bearer must be signed with a supported algorithm.', IssueType.Security);
    }

    const allowed = new Set(['ES256K', 'ES384', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87']);
    if (!allowed.has(alg)) {
      throw new ManagerError(`Unsupported controller proof bearer algorithm '${alg}'.`, IssueType.Security);
    }

    const payload = JSON.parse(Content.bytesToStringUTF8(Content.base64ToBytes(parts[1])));
    if (!payload?.vp || typeof payload.vp !== 'object') {
      throw new ManagerError('Controller proof bearer must carry one vp claim.', IssueType.Security);
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && Number(payload.exp) < now) {
      throw new ManagerError('Controller proof bearer has expired.', IssueType.Security);
    }
    if (payload.nbf !== undefined && Number(payload.nbf) > now) {
      throw new ManagerError('Controller proof bearer is not active yet.', IssueType.Security);
    }

    if ((alg === 'ES256K' || alg === 'ES384') && header.jwk && typeof header.jwk === 'object') {
      try {
        const keyLike = await importJWK(header.jwk as JWK, alg);
        await compactVerify(compact, keyLike);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ManagerError(`Invalid controller proof bearer signature: ${message}`, IssueType.Security);
      }
    } else if (alg === 'ES256K' || alg === 'ES384') {
      throw new ManagerError('Controller proof bearer must embed one public JWK for ES256K/ES384 verification.', IssueType.Security);
    }

    return { valid: true, payload };
  }
}
