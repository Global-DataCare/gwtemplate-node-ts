// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/managers/AuthorizationManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { AppAuthorizationManager } from '../../managers/AppAuthorizationManager';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { ITokenVerifier } from '../../auth/ITokenVerifier';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import {
  buildDeterministicIdTokenFixture,
  buildDeterministicSignedJwt,
  buildDeterministicVpTokenFixture,
  DeterministicJwtTokenVerifier,
} from '../utils/deterministic-jwt-fixtures';
import {
  ClassicalJoseSignatureAlgorithms,
  CommunicationKeyPurposes,
} from 'gdc-common-utils-ts/constants/cryptography';
import {
  EXAMPLE_PROFILE_PROVIDER_DID,
  EXAMPLE_SECTOR,
  EXAMPLE_TENANT_IDENTIFIER,
  EXAMPLE_TENANT_SERVICE_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';

// --- Mocks ---

const mockVaultRepository: jest.Mocked<IVaultRepository> = {
  get: jest.fn(),
  put: jest.fn(),
  // Other methods required by the interface
  createNewVault: jest.fn(), vaultExists: jest.fn(), getVaultConfig: jest.fn(),
  createNewSection: jest.fn(), updateSection: jest.fn(), getAllSections: jest.fn(),
  sectionExists: jest.fn(), getContainersListInSection: jest.fn(), listContainersInSection: jest.fn(), getContainersInSection: jest.fn(),
  getHistory: jest.fn(), query: jest.fn(), delete: jest.fn(), purge: jest.fn(),
};

const mockTokenVerifier: jest.Mocked<ITokenVerifier> = {
  verify: jest.fn(),
};

const mockKmsService: jest.Mocked<IKmsService> = {
    getPublicVerificationKey: jest.fn(),
    // Add other methods as needed, satisfying the interface
    init: jest.fn(), provisionKeys: jest.fn(), getPublicJwks: jest.fn(),
    getPublicEncryptionKey: jest.fn(), getHostPublicJwkSet: jest.fn(),
    decodeRequest: jest.fn(), signWithManagedKey: jest.fn(),
    signWithReconstructedKey: jest.fn(), encodeResponse: jest.fn(),
    createDetachedJws: jest.fn(),
    createCompactJws: jest.fn(),
    protectConfidentialData: jest.fn(), unprotectConfidentialData: jest.fn(),
    getHmacBase64Url: jest.fn(), protectAttributesNameAndValue: jest.fn(),
};

// A mock for the low-level crypto service, needed for signature verification
const mockCryptographyService: jest.Mocked<ICryptography> = {
    verifyJws: jest.fn(),
} as any;


// --- Tests ---

describe('AppAuthorizationManager', () => {
  let manager: AppAuthorizationManager;
  const now = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new AppAuthorizationManager(
        mockVaultRepository, 
        mockTokenVerifier, 
        mockKmsService, 
        mockCryptographyService
    );
  });

  describe('verifyIdToken', () => {
    it('should return a valid result for a correct id_token', async () => {
      // Arrange
      const mockPayload = { sub: 'user-123', email: 'test@example.com' };
      mockTokenVerifier.verify.mockResolvedValue({ valid: true, payload: mockPayload });

      // Act
      const result = await manager.verifyIdToken('valid.id.token');

      // Assert
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
    });

    it('should throw a ManagerError for an invalid id_token', async () => {
        // Arrange
        mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'Invalid signature' });
  
        // Act & Assert
        await expect(manager.verifyIdToken('invalid.id.token'))
            .rejects.toThrow('ID token is invalid: Invalid signature');
    });

    it('should validate one deterministically signed id_token through a local virtual BFF verifier', async () => {
      const fixture = await buildDeterministicIdTokenFixture({
        seed: 'gw-auth-manager-seed-001',
        issuer: 'did:web:bff.demo.example',
        audience: 'gw-demo-audience',
        subject: 'controller-sub-001',
        email: 'controller@example.org',
      });
      const verifier = new DeterministicJwtTokenVerifier({
        issuer: 'did:web:bff.demo.example',
        audience: 'gw-demo-audience',
        publicJwk: fixture.publicJwk,
      });
      manager = new AppAuthorizationManager(
        mockVaultRepository,
        verifier,
        mockKmsService,
        mockCryptographyService,
      );

      const result = await manager.verifyIdToken(fixture.compactToken);

      expect(result.valid).toBe(true);
      expect(result.payload).toMatchObject({
        email: 'controller@example.org',
        sub: 'controller-sub-001',
      });
    });
  });

  describe('verifyBearerToken', () => {
    it('accepts a tenant-signed SMART access token only when a data route opts in', async () => {
      const algorithm = ClassicalJoseSignatureAlgorithms.Es384;
      const vaultId = getTenantVaultId(EXAMPLE_SECTOR, EXAMPLE_TENANT_IDENTIFIER);
      const fixture = await buildDeterministicSignedJwt({
        seed: EXAMPLE_TENANT_IDENTIFIER,
        purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
        alg: algorithm,
        payload: {
          iss: EXAMPLE_TENANT_SERVICE_DID,
          sub: EXAMPLE_PROFILE_PROVIDER_DID,
          aud: EXAMPLE_TENANT_SERVICE_DID,
          scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
          iat: now,
          nbf: now,
          exp: now + 300,
        },
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getPublicVerificationKey.mockResolvedValue(fixture.publicJwk as any);
      mockCryptographyService.verifyJws.mockRejectedValue(new Error('ES384 is verified by JOSE'));

      const result = await (manager.verifyBearerToken as any)(
        fixture.compactToken,
        undefined,
        { vaultId },
        { acceptSmartAccessToken: true },
      );

      expect(result).toEqual({
        valid: true,
        payload: expect.objectContaining({
          iss: EXAMPLE_TENANT_SERVICE_DID,
          sub: EXAMPLE_PROFILE_PROVIDER_DID,
        }),
      });
      expect(mockKmsService.getPublicVerificationKey).toHaveBeenCalledWith(
        vaultId,
        algorithm,
        CommunicationKeyPurposes.CommunicationSignature,
      );
      expect(mockCryptographyService.verifyJws).not.toHaveBeenCalled();
    });

    it('should fall back to one signed controller proof bearer when id_token verification fails', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-bearer-seed-001',
        issuerDid: 'did:web:controller.demo.example',
        audience: 'did:web:gw.demo.example#tenant_lifecycle',
        credentials: [
          {
            credential: {
              '@context': ['https://www.w3.org/2018/credentials/v1'],
              type: ['VerifiableCredential', 'LegalParticipantCredential'],
              issuer: 'did:web:ica.demo.example',
              issuanceDate: '2040-01-01T00:00:00.000Z',
              credentialSubject: {
                id: 'did:web:controller.demo.example',
              },
            },
          },
        ],
      });

      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });

      const result = await manager.verifyBearerToken(fixture.compactToken);

      expect(result.valid).toBe(true);
      expect(result.payload).toMatchObject({
        iss: 'did:web:controller.demo.example',
      });
      expect((result.payload as any).vp).toBeDefined();
    });
    it('keeps projected public JWK verification only outside tenant DCR scope', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-request-meta-seed-001',
        issuerDid: 'did:web:controller.demo.example',
        audience: 'did:web:gw.demo.example',
        includePublicJwkInHeader: false,
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalParticipantCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: 'did:web:controller.demo.example' },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });

      const result = await manager.verifyBearerToken(fixture.compactToken, fixture.publicJwk);

      expect(result.valid).toBe(true);
      expect(result.payload).toMatchObject({ iss: 'did:web:controller.demo.example' });
    });

    it('verifies a post-DCR controller proof with the registered key', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-registered-seed-001',
        issuerDid: 'did:web:controller.registered.example',
        audience: 'did:web:gw.demo.example',
        includePublicJwkInHeader: false,
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalParticipantCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: 'did:web:controller.registered.example' },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getHmacBase64Url
        .mockResolvedValueOnce('protected-kid-name')
        .mockResolvedValueOnce('protected-kid-value');
      mockVaultRepository.query.mockResolvedValue([{ id: 'controller-record' }] as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValue({
        didDocument: {
          id: 'did:web:controller.registered.example',
          verificationMethod: [{
            id: `did:web:controller.registered.example#${fixture.publicJwk.kid}`,
            type: 'JsonWebKey2020',
            controller: 'did:web:controller.registered.example',
            publicKeyJwk: fixture.publicJwk,
          }],
        },
      } as any);

      const result = await manager.verifyBearerToken(
        fixture.compactToken,
        undefined,
        { vaultId: 'onehealth-research_registered', collectionName: 'registered_collection' },
      );

      expect(result.valid).toBe(true);
      expect(mockVaultRepository.query).toHaveBeenCalledWith('registered_collection', {
        sectionId: getEnvSectionId('employees'),
        where: [{ name: 'protected-kid-name', value: 'protected-kid-value' }],
      });
    });

    it('rejects a tenant-scoped proof when its kid is not registered by DCR', async () => {
      const fixture = await buildDeterministicVpTokenFixture({
        seed: 'gw-controller-proof-unregistered-seed-001',
        issuerDid: 'did:web:controller.unregistered.example',
        audience: 'did:web:gw.demo.example',
        credentials: [{ credential: {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalParticipantCredential'],
          issuer: 'did:web:ica.demo.example',
          issuanceDate: '2040-01-01T00:00:00.000Z',
          credentialSubject: { id: 'did:web:controller.unregistered.example' },
        } }],
      });
      mockTokenVerifier.verify.mockResolvedValue({ valid: false, error: 'not an id token' });
      mockKmsService.getHmacBase64Url
        .mockResolvedValueOnce('protected-kid-name')
        .mockResolvedValueOnce('protected-kid-value');
      mockVaultRepository.query.mockResolvedValue([]);

      await expect(manager.verifyBearerToken(
        fixture.compactToken,
        fixture.publicJwk,
        { vaultId: 'onehealth-research_registered', collectionName: 'registered_collection' },
      )).rejects.toThrow('kid is not registered for this tenant');
    });
  });
  
  describe('verifyAndConsumeActivationCode', () => {
    it('should return a valid license and mark it as active', async () => {
        // Arrange
        const activationCode = 'valid-code';
        const tenantId = 'acme';
        const vaultId = getTenantVaultId('health-care', tenantId);
        const mockLicense: DeviceLicense = {
          id: 'license-1', tenantId: tenantId, status: 'issued', plan: 'annual',
          orderId: 'order-123', userClass: 'employee', type: 'mobile',
          renewalCycle: '12m', reactivationEnabled: true, exp: now + 3600,
          activationCode, issuedToEmail: 'person@example.org',
        };
        const mockDoc: ConfidentialStorageDoc = { id: activationCode, status: mockLicense.status, sequence: 0, content: mockLicense };
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([mockDoc]);
  
        // Act
        const result = await manager.verifyAndConsumeActivationCode(
          activationCode, tenantId, 'health-care',
          { subject: 'portal-sub', email: 'person@example.org', emailVerified: true },
        );
  
        // Assert
        expect(result.valid).toBe(true);
        if (result.valid) {
            expect(result.license.activationCode).toBe(activationCode);
        }
        expect(mockVaultRepository.query).toHaveBeenCalledWith(
          vaultId,
          expect.objectContaining({ sectionId: getEnvSectionId('device-licenses') }),
        );
        
        // Verify it updated the license status to 'active'
        const [updatedVaultId, updatedDocs] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
        expect(updatedVaultId).toBe(vaultId);
        expect(updatedDocs[0].status).toBe('active');
        expect(updatedDocs[0].content.status).toBe('active');
        expect(updatedDocs[0].sequence).toBe(1);
      });

      it('should throw an error if activation code is not found', async () => {
        // Arrange
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.getContainersInSection.mockResolvedValue([]);
  
        // Act & Assert
        await expect(manager.verifyAndConsumeActivationCode('not-found', 'acme', 'health-care'))
            .rejects.toThrow('Activation code not found or invalid.');
      });

      it('should reuse an active seat for a second installation of the same authenticated user', async () => {
        // Arrange
        const mockLicense = {
          id: 'license-2', tenantId: 'acme', status: 'active', plan: 'annual',
          orderId: 'order-456', userClass: 'employee', type: 'web',
          renewalCycle: null, reactivationEnabled: false, exp: now + 3600,
          activationCode: 'used-code',
          issuedToEmail: 'professional@example.org',
          activatedBy: normalizeSameAsHash('professional@example.org'),
          maxDevices: 5,
          deviceBindings: [{
            clientId: 'client-one', clientInstanceId: 'install-one', status: 'active',
            deviceInfo: { clientInstanceId: 'install-one' }, activatedAt: now,
          }],
        } as DeviceLicense & Record<string, any>;
        mockKmsService.getHmacBase64Url
          .mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value')
          .mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([{ id: 'used-code', content: mockLicense, sequence: 0 }]);

        await expect(manager.verifyAndConsumeActivationCode(
          'used-code', 'acme', 'health-care',
          { subject: 'portal-a-sub', email: 'professional@example.org', emailVerified: true }, 'install-two',
        )).resolves.toMatchObject({ valid: true });
        await expect(manager.verifyAndConsumeActivationCode(
          'used-code', 'acme', 'health-care',
          { subject: 'portal-b-sub', email: 'other@example.org', emailVerified: true }, 'install-two',
        )).rejects.toThrow('does not match the licensed email');
      });

      it('decrypts an indexed protected seat before reusing its activation credential', async () => {
        const protectedLicenseDoc = {
          id: 'protected-license',
          status: 'active',
          sequence: 3,
          indexed: { attributes: [{ name: 'protected-name', value: 'protected-value' }] },
          jwe: { ciphertext: 'protected-license-ciphertext' },
        } as unknown as ConfidentialStorageDoc;
        const decryptedLicense = {
          id: protectedLicenseDoc.id,
          tenantId: 'acme',
          status: 'active',
          plan: 'annual',
          orderId: 'order-protected',
          userClass: 'employee',
          type: 'web',
          renewalCycle: null,
          reactivationEnabled: false,
          exp: now + 3600,
          activationCode: 'protected-code',
          issuedToEmail: 'professional@example.org',
          activatedBy: normalizeSameAsHash('professional@example.org'),
          maxDevices: 5,
          deviceBindings: [{
            clientId: 'client-one',
            clientInstanceId: 'install-one',
            status: 'active',
          }],
        } as DeviceLicense & Record<string, any>;
        mockKmsService.getHmacBase64Url
          .mockResolvedValueOnce('protected-name')
          .mockResolvedValueOnce('protected-value');
        mockVaultRepository.query.mockResolvedValue([protectedLicenseDoc]);
        mockKmsService.unprotectConfidentialData.mockResolvedValue(decryptedLicense as any);

        await expect(manager.verifyAndConsumeActivationCode(
          'protected-code',
          'acme',
          'health-care',
          { subject: 'portal-subject', email: 'professional@example.org', emailVerified: true },
          'install-one',
        )).resolves.toMatchObject({ valid: true, license: decryptedLicense });

        expect(mockKmsService.unprotectConfidentialData).toHaveBeenCalledWith(
          protectedLicenseDoc,
          getTenantVaultId('health-care', 'acme'),
        );
      });

      it('should bind a legacy active seat to its first authenticated reuse', async () => {
        const mockLicense = {
          id: 'legacy-license', tenantId: 'acme', status: 'active', plan: 'annual',
          orderId: 'legacy-order', userClass: 'employee', type: 'web',
          renewalCycle: null, reactivationEnabled: false, exp: now + 3600,
          activationCode: 'legacy-code', issuedToEmail: 'professional@example.org',
          activatedBy: 'legacy-firebase-subject',
        } as DeviceLicense & Record<string, any>;
        mockKmsService.getHmacBase64Url.mockResolvedValueOnce('hmac-name').mockResolvedValueOnce('hmac-value');
        mockVaultRepository.query.mockResolvedValue([{ id: 'legacy-code', content: mockLicense, sequence: 0 }]);

        await manager.verifyAndConsumeActivationCode(
          'legacy-code', 'acme', 'health-care',
          { subject: 'new-portal-subject', email: 'professional@example.org', emailVerified: true }, 'install-one',
        );

        expect(mockLicense).toMatchObject({
          activatedBy: normalizeSameAsHash('professional@example.org'),
          maxDevices: 5,
        });
        expect(mockVaultRepository.put).toHaveBeenCalled();
      });
  });

  describe('rotateEmployeeActivationCodeForOwnedDevice', () => {
    it('rotates only the active seat bound to the OTP-authenticated email and installation', async () => {
      const license = {
        id: 'license-rotation', tenantId: 'acme', status: 'active', plan: 'annual',
        orderId: 'order-rotation', userClass: 'employee', type: 'web',
        renewalCycle: null, reactivationEnabled: true, exp: now + 3600,
        activationCode: 'lic-old-code', issuedToEmail: 'professional@example.org',
        issuedToRole: 'medical-secretary',
        activatedBy: normalizeSameAsHash('professional@example.org'),
        maxDevices: 5,
        deviceBindings: [{
          clientId: 'old-client', clientInstanceId: 'browser-installation', status: 'active',
        }],
      } as DeviceLicense & Record<string, any>;
      mockVaultRepository.getContainersInSection.mockResolvedValue([{
        id: license.id, status: 'active', sequence: 4, content: license,
      } as any]);
      mockKmsService.protectAttributesNameAndValue.mockResolvedValue([
        { name: 'protected-name', value: 'protected-value', unique: true, type: 'string' },
      ] as any);

      const result = await manager.rotateEmployeeActivationCodeForOwnedDevice(
        'acme',
        'health-care',
        { subject: 'portal-owner', email: 'professional@example.org', emailVerified: true },
        'browser-installation',
      );

      expect(result.activationCode).toMatch(/^lic-[A-Za-z0-9_-]+$/);
      expect(result.activationCode).not.toBe('lic-old-code');
      expect(result.licenseId).toBe('license-rotation');
      expect(result.employeeRole).toBe('medical-secretary');
      expect(result.employeeActorIdentifier).toBe(normalizeSameAsHash('professional@example.org'));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        getTenantVaultId('health-care', 'acme'),
        [expect.objectContaining({
          status: 'active',
          sequence: 5,
          content: expect.objectContaining({
            activationCode: result.activationCode,
            deviceBindings: license.deviceBindings,
          }),
        })],
        getEnvSectionId('device-licenses'),
      );
    });

    it('rejects a different email even when it knows the installation id', async () => {
      mockVaultRepository.getContainersInSection.mockResolvedValue([{
        id: 'license-other-owner', status: 'active', sequence: 1, content: {
          id: 'license-other-owner', tenantId: 'acme', status: 'active',
          userClass: 'employee', type: 'web', exp: now + 3600,
          issuedToEmail: 'owner@example.org', activationCode: 'lic-owner',
          deviceBindings: [{ clientId: 'client-owner', clientInstanceId: 'known-installation', status: 'active' }],
        },
      } as any]);

      await expect(manager.rotateEmployeeActivationCodeForOwnedDevice(
        'acme',
        'health-care',
        { subject: 'attacker', email: 'attacker@example.org', emailVerified: true },
        'known-installation',
      )).rejects.toThrow(/licensed email/i);
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });
  });

  // Future tests for `verifyInitialAccessToken` will be added here
});
