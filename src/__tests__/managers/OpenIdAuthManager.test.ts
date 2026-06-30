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
  testConsentRulePermitOrgDidMultiRole,
} from '../data/consent-rules.data';
import { IClearingHouseService } from '../../services/ClearingHouseService';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { addVC, createVP } from 'gdc-common-utils-ts/utils/vp-token';
import { createClientAssertion } from '../utils/client-assertion-fixtures';

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=*',
          purpose: 'TREAT',
          expires_in: 300,
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    };

    const response = await manager.process(job);
    expect(response.body.access_token).toContain('.sig');
    expect(response.body.scope).toContain('organization/Composition.rs');
    expect(response.body.ledger_verified).toBe(true);
    expect(mockKmsService.signWithManagedKey).toHaveBeenCalled();
    expect(mockClearingHouse.verifyVpToken).toHaveBeenCalled();
  });

  it('should match section tokens regardless of LOINC system casing or URL form', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.action': 'loinc|48765-2',
        },
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=http://loinc.org|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should permit one canonical stored Composition action without organization prefix', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.action': 'Composition.rs?section=LOINC|48765-2,LOINC|10160-0',
        },
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|10160-0',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject patient/Composition root scopes', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn(),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    } as any;

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
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('patient/* scopes are not accepted');
  });

  it('should reject patient/ResearchSubject root scopes', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn(),
      put: jest.fn(),
      get: jest.fn(),
      getHistory: jest.fn(),
      query: jest.fn(),
      delete: jest.fn(),
      purge: jest.fn(),
    } as any;

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
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: `patient/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`,
          purpose: 'RESEARCH',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('patient/* scopes are not accepted');
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);
    expect(response.body.access_token).toBeDefined();
  });

  it('should permit when rule actor-role is a comma-separated list and one role matches', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitOrgDidMultiRole }] as any),
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow("Missing 'vp_token'");
  });

  it('should deny when a direct physician deny overrides a broader organization allow', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        { ...testConsentRulePermitOrgDid },
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.decision': 'deny',
          'Consent.actor-role': 'ISCO-08|2211',
        },
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
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No matching consent rule found for requested scope.');
  });

  it('should permit a related person targeted directly by email', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.actor-identifier': 'guardian@example.org',
          'Consent.actor-role': 'v3-RoleCode|RESPRSN',
        },
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
          sub: 'did:web:api.acme.org:family:guardian@example.org:v3-RoleCode|RESPRSN',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=LOINC|48765-2',
          purpose: 'TREAT',
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should require and accept a matching inter-tenant contract for a foreign organization actor', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
        },
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

    const vpPayload = createVP({
      iss: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
      sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
    });
    addVC(vpPayload, EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL);

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
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
          purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          vp_token: JSON.stringify(vpPayload),
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should deny a foreign organization actor when no matching inter-tenant contract is presented', async () => {
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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
        },
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
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
          purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          vp_token: JSON.stringify(createVP({
            iss: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          })),
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No active inter-tenant access contract found');
  });

  it('should accept one trusted external research bearer instead of vp_token for inter-tenant research access', async () => {
    // In the external research profile:
    // - bearer token carries the external access proof (Pontus-X style)
    // - client_assertion still authenticates the registered researcher client
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-002';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': 'RESEARCH',
        },
      ] as any),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: 'RESEARCH',
                scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
          purpose: 'RESEARCH',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(response.body.ledger_verified).toBe(true);
    expect(mockClearingHouse.verifyVpToken).not.toHaveBeenCalled();
  });

  it('should accept one trusted external research bearer for ResearchSubject scope when the stored action is canonical', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-rs-001';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.purpose': 'RESEARCH',
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: 'RESEARCH',
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: researchSubjectScope,
          purpose: 'RESEARCH',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(response.body.ledger_verified).toBe(true);
  });

  it('should accept one research employee when the permit is role-specific and matches the requester role', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-role-allow';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.actor-role': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.actorRole,
          'Consent.purpose': 'RESEARCH',
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: 'RESEARCH',
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          scope: researchSubjectScope,
          purpose: 'RESEARCH',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject one research employee when the permit role does not match the requester role', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher2@lab.org:device:client-role-deny';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitOrgDid,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          'Consent.actor-role': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.actorRole,
          'Consent.purpose': 'RESEARCH',
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: 'RESEARCH',
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: 'did:web:api.lab.org:employee:researcher2@lab.org:ISCO-08|2166',
          scope: researchSubjectScope,
          purpose: 'RESEARCH',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No matching consent rule found for requested scope.');
  });

  it('should accept one research employee when the permit targets the requester email directly', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-email-allow';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': 'researcher1@lab.org',
          'Consent.actor-role': '*',
          'Consent.purpose': 'RESEARCH',
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: 'RESEARCH',
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: 'did:web:api.lab.org:employee:researcher1@lab.org:ISCO-08|2166',
          scope: researchSubjectScope,
          purpose: 'RESEARCH',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
  });

  it('should reject one research employee when a direct-email permit targets another employee', async () => {
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';
    const researchSubjectScope = `organization/ResearchSubject.rs?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;
    const clientId = 'did:web:lab.example:employee:researcher2@lab.org:device:client-email-deny';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([
        {
          ...testConsentRulePermitEmailWildcardRole,
          'Consent.subject': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
          'Consent.actor-identifier': 'researcher1@lab.org',
          'Consent.actor-role': '*',
          'Consent.purpose': 'RESEARCH',
          'Consent.action': 'ResearchSubject.rs',
        },
      ] as any),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        meta: {
          bearer: {
            token: 'Bearer external',
            jwt: {
              header: {},
              payload: {
                iss: 'https://pontus-x.example',
                aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
                consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
                purpose: 'RESEARCH',
                scope: researchSubjectScope,
                amr: ['external_bearer'],
              },
            },
          },
        },
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'client_assertion',
          sub: 'did:web:api.lab.org:employee:researcher2@lab.org:ISCO-08|2166',
          scope: researchSubjectScope,
          purpose: 'RESEARCH',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest)).rejects.toThrow('No matching consent rule found for requested scope.');
  });

  it('should accept one professional SMART request with vp_token plus client_assertion', async () => {
    // Professional SMART baseline:
    // - `client_assertion` proves possession of the device private key
    // - `vp_token` remains the authorization/holder-proof input for OIDC4VP
    const clientId = 'did:web:api.acme.org:employee:doctor1@acme.org:device:client-001';
    const clientAssertion = await createClientAssertion({
      clientId,
      audience: 'did:web:api.acme.org',
    });

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
      tenantExists: jest.fn().mockResolvedValue(true),
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
      listContainersInSection: jest.fn(),
      getContainersInSection: jest.fn().mockResolvedValue([{ ...testConsentRulePermitOrgDid }] as any),
      put: jest.fn(),
      get: jest.fn().mockResolvedValue(undefined),
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
        iss: clientId,
        aud: 'did:web:api.acme.org',
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'private_key_jwt',
          sub: 'did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211',
          scope: 'organization/Composition.rs?subject=did:web:api.acme.org:individual:123&section=*',
          purpose: 'TREAT',
          expires_in: 300,
          vp_token: 'vp',
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      } as any,
    } as JobRequest);

    expect(response.body.access_token).toBeDefined();
    expect(mockClearingHouse.verifyVpToken).toHaveBeenCalled();
  });
});
