// src/__tests__/unit/managers/TenantsCacheManager.url.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { DemoKmsService } from '../../../services/DemoKmsService';
import { KmsService } from '../../../services/KmsService';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { testConfigTenant1, testTenant1IdentifierUrn, testHostDidWeb } from '../../data/organization.data';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';

describe('TenantsCacheManager - getTenantDomainUrl', () => {
  let tenantsCacheManager: TenantsCacheManager;
  let realKmsService: KmsService;

  const hostConfig: EntityConfig = {
    id: 'host-id',
    status: 'active',
    claims: { [ClaimsOrganizationSchemaorg.alternateName]: 'host' },
    didDocument: { '@context': 'https://www.w3.org/ns/did/v1', id: testHostDidWeb },
  } as any;

  const tenantConfigWithUrl: EntityConfig = {
    ...testConfigTenant1,
    didDocument: { ...testConfigTenant1.didDocument, id: testTenant1IdentifierUrn },
    claims: {
      ...testConfigTenant1.claims,
      [ClaimsOrganizationSchemaorg.url]: 'acme.example.com',
    }
  } as any;

  const tenantConfigWithoutUrl: EntityConfig = { 
    ...testConfigTenant1,
    didDocument: { ...testConfigTenant1.didDocument, id: testTenant1IdentifierUrn },
  } as any;
  delete (tenantConfigWithoutUrl.claims as any)[ClaimsOrganizationSchemaorg.url];

  beforeEach(() => {
    const cryptoService = new CryptographyService(new AdapterCryptoSdkNode());
    const vaultRepository = new VaultMemRepository();
    tenantsCacheManager = new TenantsCacheManager(vaultRepository, () => realKmsService, 'test-host-collection');
    realKmsService = new KmsService(cryptoService, tenantsCacheManager);
    const demoKmsService = new DemoKmsService(realKmsService);
    // Even though we instantiate demoKmsService, the tenantsCacheManager holds a reference to the real one.
    // This is correct as its internal operations (like decryption) should use the real KMS.

    // Spy on getDidDocument and mock its implementation
    jest.spyOn(tenantsCacheManager, 'getDidDocument').mockImplementation(async (vaultId: string) => {
      if (vaultId === 'host') return hostConfig.didDocument;
      if (vaultId === 'health-care_acme_with_url') return tenantConfigWithUrl.didDocument;
      if (vaultId === 'health-care_acme_no_url') return tenantConfigWithoutUrl.didDocument;
      return undefined;
    });

    // Manually set up the internal cache for the tests.
    (tenantsCacheManager as any).tenantCacheByVaultId.set('host', hostConfig);
    (tenantsCacheManager as any).tenantCacheByVaultId.set('health-care_acme_with_url', tenantConfigWithUrl);
    (tenantsCacheManager as any).tenantCacheByVaultId.set('health-care_acme_no_url', tenantConfigWithoutUrl);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return the external domain URL with https if the claim exists', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('health-care_acme_with_url');
    // ASSERT
    expect(url).toBe('https://acme.example.com');
  });

  it('should construct the correct hosted URL if the external domain claim is missing', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('health-care_acme_no_url');
    // ASSERT
    const hostDomain = testHostDidWeb.replace('did:web:', '');
    const urnParts = testTenant1IdentifierUrn.split(':');
    // The jurisdiction (urnParts[3]) must be lower-cased to match the canonical URL format.
    const expectedUrl = `https://${hostDomain}/acme/cds-${urnParts[3].toLowerCase()}/${urnParts[4]}/${urnParts[5]}`;
    expect(url).toBe(expectedUrl);
  });
  
  it('should return the host URL for the host vaultId', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('host');
    // ASSERT
    const hostDomain = testHostDidWeb.replace('did:web:', '');
    expect(url).toBe(`https://${hostDomain}`);
  });

  it('should return undefined for a non-existent vaultId', async () => {
    // ACT
    const url = await tenantsCacheManager.getTenantDomainUrl('non-existent-vault');
    // ASSERT
    expect(url).toBeUndefined();
  });
});
