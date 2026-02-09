// src/__tests__/managers/OpenIdAuthManager.test.ts

import { OpenIdAuthManager } from '../../managers/OpenIdAuthManager';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import {
  testConsentRulePermitEmailWildcardRole,
  testConsentRulePermitJurisdiction,
  testConsentRulePermitOrgDid,
} from '../data/consent-rules.data';
import { IClearingHouseService } from '../../services/ClearingHouseService';

describe('OpenIdAuthManager', () => {
  it('should issue a signed access_token for a tenant (org did rule)', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({
        payload: '',
        signatures: [{ protected: 'p', signature: 'sig' }],
      } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: jest.fn(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        { ...testConsentRulePermitOrgDid },
      ] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    const job: JobRequest = {
      tenantId: 'acme',
      jurisdiction: 'es',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        jti: 'jti',
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'patient/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          expires_in: 300,
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    };

    const response = await manager.process(job);
    expect(response.body.access_token).toContain('.sig');
    expect(response.body.scope).toContain('patient/Composition.rs');
    expect(response.body.ledger_verified).toBe(true);
    expect(mockKmsService.signWithManagedKey).toHaveBeenCalled();
    expect(mockClearingHouse.verifyVpToken).toHaveBeenCalled();
  });

  it('should permit when rule is jurisdiction urn (ES)', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: jest.fn(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitJurisdiction }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );
    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'patient/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);
    expect(response.body.access_token).toBeDefined();
  });

  it('should permit when rule is email with wildcard role', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn().mockResolvedValue({ payload: '', signatures: [{ protected: 'p', signature: 'sig' }] } as any),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: jest.fn(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitEmailWildcardRole }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: 'hash',
        ledgerVerified: true,
      }),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );
    const response = await manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'patient/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);
    expect(response.body.access_token).toBeDefined();
  });

  it('should reject when vp_token is missing', async () => {
    const mockKmsService: jest.Mocked<IKmsService> = {
      init: jest.fn(),
      provisionKeys: jest.fn(),
      getPublicJwks: jest.fn(),
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-sig-kid' } as any),
      getPublicEncryptionKey: jest.fn(),
      getHostPublicJwkSet: jest.fn(),
      decodeRequest: jest.fn(),
      signWithManagedKey: jest.fn(),
      signWithReconstructedKey: jest.fn(),
      createDetachedJws: jest.fn(),
      createCompactJws: jest.fn(),
      encodeResponse: jest.fn(),
      protectConfidentialData: jest.fn(),
      unprotectConfidentialData: jest.fn(),
      getHmacBase64Url: jest.fn(),
      protectAttributesNameAndValue: jest.fn(),
    };

    const mockTenantsCacheManager: jest.Mocked<TenantsCacheManager> = {
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:api.acme.org' } as any),
    } as any;

    const mockVaultRepository: jest.Mocked<IVaultRepository> = {
      createNewVault: jest.fn(),
      vaultExists: jest.fn().mockResolvedValue(true),
      getVaultConfig: jest.fn().mockResolvedValue({ id: 'vault' } as any),
      createNewSection: jest.fn(),
      updateSection: jest.fn(),
      getAllSections: jest.fn(),
      sectionExists: jest.fn(),
      getContainersListInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitOrgDid }] as any),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    };

    const mockClearingHouse: jest.Mocked<IClearingHouseService> = {
      verifyVpToken: jest.fn(),
    };

    const manager = new OpenIdAuthManager(
      mockKmsService,
      mockTenantsCacheManager,
      mockVaultRepository,
      mockClearingHouse,
    );

    await expect(manager.process({
      tenantId: 'acme',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'identity',
      format: 'openid',
      resourceType: 'smart',
      action: 'token',
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      content: {
        thid: 'thid',
        iss: 'did:web:device.example',
        aud: 'did:web:api.acme.org',
        body: {
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'patient/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow("Missing 'vp_token'");
  });
});
