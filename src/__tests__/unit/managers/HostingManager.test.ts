// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/managers/HostingManager.test.ts

import { jest } from '@jest/globals';
import {
  ORGANIZATION_ORDER_JOB,
  ORGANIZATION_REGISTRATION_JOB,
} from '../../data/example-jobs';
import {
  testHostData,
  testTenant1Data,
  testClaimsTenant1Registration,
  testClaimsHostInitialization,
  testClaimsTenant1AlternateNameInvalidPrefix,
} from '../../data/end-to-end.data';
import * as tenantUtils from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { getEnvSectionId } from '../../../utils/section-env';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { EntityConfig } from '../../../gdc-backend-utils-node/models/entity';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';
import { initializeHostServicesConfig } from '../../../utils/services';

import { ILogger } from '../../../loggers/ILogger';
import { testTenant1LegalName } from '../../data/organization.data';
import { composeHostDidWebId } from '../../../utils/did-backend';

const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { v4: uuidv4, validate: uuidValidate } = await import('uuid');
const { HostingManager } = await import('../../../managers/HostingManager');
const { ManageAssetOrganization } = await import('../../../blockchain/fabric/v3/manageAssetOrganization');
const { ManageAssetCryptographicKey } = await import('../../../blockchain/fabric/v3/manageAssetCryptographicKey');
const { ManageAssetSubjectKeyBinding } = await import('../../../blockchain/fabric/v3/manageAssetSubjectKeyBinding');
const { ManageAssetArtifact } = await import('../../../blockchain/fabric/v3/manageAssetArtifact');
const { ManageAssetArtifactEvent } = await import('../../../blockchain/fabric/v3/manageAssetArtifactEvent');
const { registerOrganizationOnLedger } = await import('../../../utils/ledger-organization-registration');

const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};


const mockPublicKeys: JwkSet = {
  keys: [
    { kid: 'key-1', kty: 'OKP', crv: 'Ed25519', x: '...', use: 'sig' },
    { kid: 'key-2', kty: 'OKP', crv: 'X25519', x: '...', use: 'enc' },
  ],
};

// Create a mock KMS service for testing.
const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as jest.MockedFunction<IKmsService['provisionKeys']>,
  getPublicJwks: jest.fn() as jest.MockedFunction<IKmsService['getPublicJwks']>,
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string): Promise<ConfidentialStorageDoc> => {
    // In this mock, we retain the content so that unprotect can retrieve it.
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' }, content: doc.content };
    delete (secureDoc as any).protectedAttributes;
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc, entityId: string) =>
    Promise.resolve(doc.content as any),
  ),
  createDetachedJws: jest.fn(),
  createCompactJws: jest.fn(),
  getHostPublicJwkSet: jest.fn(),  
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const testBaseJobForClaims = (claims: ClaimsRecord): JobRequest => ({
  id: 'job-id-123',
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  tenantId: (claims as any)[ClaimsOrganizationSchemaorg.alternateName] || 'host',
  jurisdiction: (claims as any)[ClaimsOrganizationSchemaorg.addressCountry],
  resourceType: 'Organization',
  section: 'registry',
  format: 'org.schema',
  action: '_batch',
  content: {
    iss: 'did:web:requester.example.com',
    jti: 'mock-jti-123',
    aud: 'did:web:api.example.com',
    thid: 'test-thid-123',
    type: 'json',
    body: {
      data: [
        {
          meta: { claims },
          request: { method: 'POST' },
          type: 'Organization-registration-form-v1.0',
        },
      ],
    },
  },
  httpMethod: 'POST',
  requestUrl: '/default',
});

describe('HostingManager', () => {
  let hostingManager: InstanceType<typeof HostingManager>;
  let vaultRepository: IVaultRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  const originalEnv = process.env;

  beforeEach(async () => {
    // This setup mirrors the new Offer/Order Flow tests for consistency.
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');
    (uuidValidate as jest.Mock).mockReturnValue(true);

    vaultRepository = new VaultMemRepository();
    const hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    mockTenantsCacheManager = new TenantsCacheManager(vaultRepository, () => mockKmsService, hostCollectionName) as jest.Mocked<TenantsCacheManager>;

    mockConfig = {
      securityMode: 'demo',
      networkMode: 'test',
      fhirLegacy: true,
      jsonLegacy: true,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: true,
      nodeEnv: 'test',
      port: 3000,
      maxHeaderSize: 16384,
      apiHostname: 'testhost',
      hostExternalDomain: 'testhost.com',
      apiBaseUrl: 'http://testhost:3000',
      namespace: 'test-namespace',
      sectorsAllowed: [Sector.HEALTH_CARE, Sector.SYSTEM, Sector.HEALTH_INSURANCE],
      dbProvider: 'mem',
      queueProvider: 'mem',
      storageProvider: 'mem',
      allowedPaymentMethods: ['Stripe'],
      host: {
        legalName: 'Test Host',
        jurisdiction: 'us',
        idType: 'test-id',
        idValue: '12345',
      },
      mongo: { dbName: 'test' },
      firebase: {},
    };

    const hostCollectionNameForRuntime = tenantUtils.generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    const hostRuntime = {
      hostCollectionName: hostCollectionNameForRuntime,
      hostDid: composeHostDidWebId(mockConfig.apiBaseUrl, mockConfig.hostExternalDomain),
    };

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
      hostRuntime,
    );
    
    mockKmsService.getPublicJwks.mockResolvedValue(mockPublicKeys);
    
    // Bootstrap the host. This will teach the mock repository the host's collection name.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('[1 HOST: should process the "host" initialization]', async () => {
    const job = testBaseJobForClaims(testClaimsHostInitialization);
    // In the real bootstrap, the host isn't in the cache yet, so we clear the mock for this one test.
    jest.spyOn(vaultRepository, 'get').mockResolvedValue(undefined as any);

    const responsePayload = await hostingManager.process(job);

    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    // Host registration should now also return an offer, aligning with the tenant flow.
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it('[1.1 HOST] reconciles a stale persisted host service surface and restores Organization/_transaction', async () => {
    const hostCollectionName = await mockTenantsCacheManager.getCollectionName('host') as string;
    const secureHostDoc = await vaultRepository.get(
      hostCollectionName,
      'host',
      getEnvSectionId('tenants'),
    ) as ConfidentialStorageDoc;
    expect(secureHostDoc).toBeDefined();

    const staleHostConfig = structuredClone(secureHostDoc.content as any);
    staleHostConfig.didConfig.service = staleHostConfig.didConfig.service.map((service: any) => (
      Array.isArray(service?.actions)
        ? { ...service, actions: service.actions.filter((action: string) => action !== '_transaction') }
        : service
    ));
    staleHostConfig.didDocument.service = [];

    const staleSecureDoc = await mockKmsService.protectConfidentialData({
      ...secureHostDoc,
      content: staleHostConfig,
    } as ConfidentialStorageDoc, 'host');
    await vaultRepository.put(hostCollectionName, [staleSecureDoc], getEnvSectionId('tenants'));
    await mockTenantsCacheManager.refreshTenant('host');

    const updated = await hostingManager.reconcilePersistedHostRuntimeConfig();
    expect(updated).toBe(true);

    const refreshedServices = await mockTenantsCacheManager.getDidServiceConfig('host');
    const expectedServices = initializeHostServicesConfig(
      mockConfig.sectorsAllowed as Sector[],
      mockConfig.nodeEnv,
      mockConfig.networkMode,
    );

    expect(refreshedServices).toEqual(expectedServices);
    expect(
      refreshedServices?.some((service: any) =>
        service?.selector?.section === 'registry'
        && service?.selector?.format === 'org.schema'
        && Array.isArray(service?.actions)
        && service.actions.includes('_transaction'))
    ).toBe(true);
  });

  it('[5 TENANT (Happy Path): should create full tenant config and protect it', async () => {
    // PRE-CONDITION: Ensure host vault exists before creating a tenant.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    
    const putSpy = jest.spyOn(vaultRepository, 'put');
    const initialProtectCalls = mockKmsService.protectConfidentialData.mock.calls.length;

    const job = testBaseJobForClaims(testClaimsTenant1Registration);
    const createVaultSpy = jest.spyOn(vaultRepository, 'createNewVault');

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');

    // Verify the provisional document was created in the host's vault
    const tenantVaultId = tenantUtils.getTenantVaultId(
      testClaimsTenant1Registration[ClaimsServiceSchemaorg.category] as Sector,
      testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName]
    );
    const provisionalDoc = await vaultRepository.get(
      await mockTenantsCacheManager.getCollectionName('host') as string,
      tenantVaultId,
      getEnvSectionId('tenants')
    ) as ConfidentialStorageDoc;
    expect(provisionalDoc).toBeDefined();
    expect(provisionalDoc.content).toBeDefined();
    expect(provisionalDoc.content!.status).toBe('pending');
    expect(provisionalDoc.content!.claims[ClaimsOrganizationSchemaorg.legalName]).toBe(testTenant1LegalName);

    // In the initial registration, no vault is created for the tenant yet.
    expect(createVaultSpy).not.toHaveBeenCalled();
    // Keys are not provisioned until the order is processed.
    expect(mockKmsService.provisionKeys).not.toHaveBeenCalledWith(tenantVaultId);
  });

  it('[ledger] registers organization, keys, bindings and artifacts on identity-local', async () => {
    mockConfig.networkMode = 'local-network';
    mockConfig.ledger = {
      enabled: true,
      mspId: 'Org1MSP',
      chaincodeName: 'organization-sc',
      schemaUrl: 'https://schema.example.org/organization',
    };
    const createOrganizationSpy = jest.spyOn(ManageAssetOrganization.prototype, 'createOrganization').mockResolvedValue({} as any);
    const registerKeySpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
    const upsertBindingSpy = jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);
    const upsertArtifactSpy = jest.spyOn(ManageAssetArtifact.prototype, 'upsertArtifact').mockResolvedValue({} as any);
    const createArtifactEventSpy = jest.spyOn(ManageAssetArtifactEvent.prototype, 'createArtifactEvent').mockResolvedValue({} as any);

    const signingJwk = {
      kid: 'sig-key-1',
      kty: 'EC',
      crv: 'P-256',
      x: 'f83OJ3D2xF4nA6J9x6fW3f0r0nD2wU6s5n4b3a2Z1YQ',
      y: 'x_FEzRu9QkMNFcM8Qk4HkncNHNrF4Pjk6HoydxHDB6Q',
      use: 'sig',
      alg: 'ES256',
    } as any;
    const encryptionJwk = {
      kid: 'enc-key-1',
      kty: 'EC',
      crv: 'P-256',
      x: '2hJf4nA6J9x6fW3f0r0nD2wU6s5n4b3a2Z1YQf83OJ3',
      y: '7hJf4nA6J9x6fW3f0r0nD2wU6s5n4b3a2Z1YQf83OJ3',
      use: 'enc',
      alg: 'ECDH-ES',
    } as any;
    const signedHash = 'signed-pdf-hash-001';
    const unsignedHash = 'unsigned-pdf-hash-001';
    const ledgerOrgId = 'urn:org:tax:acme-id';

    await registerOrganizationOnLedger({
      ledgerConfig: mockConfig.ledger,
      hostJurisdiction: mockConfig.host.jurisdiction,
      namespace: mockConfig.namespace,
      hostExternalDomain: mockConfig.hostExternalDomain,
      logger: mockLogger,
      orgId: 'ignored-legacy-org-id',
      organization: {
        id: 'urn:test:org:acme-id',
        type: 'Organization',
        meta: {
          claims: {
            [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
            [ClaimsOrganizationSchemaorg.identifierValue]: 'acme-id',
            [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
            [ClaimsOrganizationSchemaorg.alternateName]: 'acme-id',
          },
        },
      } as any,
      config: {
        governanceVc: { id: 'urn:vc:governance:1' } as any,
        selfDescriptionVc: { id: 'urn:vc:self-description:1' } as any,
        didDocument: {
          id: 'did:web:api.acme.org',
          verificationMethod: [
            { id: 'did:web:api.acme.org#sig-key-1', publicKeyJwk: signingJwk as any },
            { id: 'did:web:api.acme.org#enc-key-1', publicKeyJwk: encryptionJwk as any },
          ],
        },
      } as any,
      evidence: [{
        digest: [
          { type: 'DocumentHash', hashAlg: 'SHA256', hashValue: unsignedHash },
          { type: 'SignedDocumentHash', hashAlg: 'SHA256', hashValue: signedHash },
        ],
        signature: { type: 'pdf-pades', signatureValue: 'mock-signature' },
        x5c: ['leaf-cert', 'issuer-cert'],
      }] as any,
      role: 'tenant',
      sector: Sector.HEALTH_CARE,
      jurisdiction: 'ES',
    });

    expect(createOrganizationSpy).toHaveBeenCalledTimes(1);
    expect(createOrganizationSpy).toHaveBeenCalledWith('Org1MSP', ledgerOrgId, expect.objectContaining({
      orgId: ledgerOrgId,
      vc: expect.objectContaining({
        id: 'urn:vc:governance:1',
      }),
    }));

    const signingThumbprint = toJwkThumbprintSha256Urn(signingJwk as any);
    const encryptionThumbprint = toJwkThumbprintSha256Urn(encryptionJwk as any);

    expect(registerKeySpy).toHaveBeenCalledTimes(2);
    expect(registerKeySpy).toHaveBeenNthCalledWith(1, 'Org1MSP', signingThumbprint, expect.objectContaining({
      keyId: signingThumbprint,
      orgId: ledgerOrgId,
      kid: 'sig-key-1',
      use: 'sig',
      purpose: 'organization-signing',
    }));
    expect(registerKeySpy).toHaveBeenNthCalledWith(2, 'Org1MSP', encryptionThumbprint, expect.objectContaining({
      keyId: encryptionThumbprint,
      orgId: ledgerOrgId,
      kid: 'enc-key-1',
      use: 'enc',
      purpose: 'organization-encryption',
    }));

    expect(upsertBindingSpy).toHaveBeenCalledTimes(2);
    expect(upsertBindingSpy).toHaveBeenNthCalledWith(1, 'Org1MSP', `organization_${ledgerOrgId}__${signingThumbprint}`, expect.objectContaining({
      subjectType: 'organization',
      subjectId: ledgerOrgId,
      keyId: signingThumbprint,
      relationship: 'organization-signing',
      status: 'active',
    }));
    expect(upsertBindingSpy).toHaveBeenNthCalledWith(2, 'Org1MSP', `organization_${ledgerOrgId}__${encryptionThumbprint}`, expect.objectContaining({
      subjectType: 'organization',
      subjectId: ledgerOrgId,
      keyId: encryptionThumbprint,
      relationship: 'organization-encryption',
      status: 'active',
    }));

    expect(upsertArtifactSpy).toHaveBeenCalledTimes(1);
    expect(upsertArtifactSpy).toHaveBeenCalledWith('Org1MSP', `artifact_sha256_${signedHash}`, expect.objectContaining({
      artifactId: `artifact_sha256_${signedHash}`,
      hash: signedHash,
      hashAlg: 'sha256',
      artifactType: 'pdf',
      declaredBy: ledgerOrgId,
      declaredByType: 'tenant',
      status: 'declared',
      meta: expect.objectContaining({
        attributes: expect.objectContaining({
          unsignedDocumentHash: unsignedHash,
          signatureType: 'pdf-pades',
        }),
      }),
    }));

    expect(createArtifactEventSpy).toHaveBeenCalledTimes(1);
    expect(createArtifactEventSpy).toHaveBeenCalledWith('Org1MSP', expect.stringContaining(`artifact_sha256_${signedHash}__signature-observed-`), expect.objectContaining({
      artifactId: `artifact_sha256_${signedHash}`,
      eventType: 'declaration',
      eventSubType: 'pdf-signature-observed',
      actor: ledgerOrgId,
      actorType: 'tenant',
      artifactHash: signedHash,
      artifactHashAlg: 'sha256',
      status: 'active',
    }));
  });

  it('[ledger] falls back to verificationMethod id when a JWK thumbprint is unavailable', async () => {
    mockConfig.networkMode = 'local-network';
    mockConfig.ledger = {
      enabled: true,
      mspId: 'Org1MSP',
      chaincodeName: 'organization-sc',
      schemaUrl: 'https://schema.example.org/organization',
    };
    jest.spyOn(ManageAssetOrganization.prototype, 'createOrganization').mockResolvedValue({} as any);
    const registerKeySpy = jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
    const upsertBindingSpy = jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);
    jest.spyOn(ManageAssetArtifact.prototype, 'upsertArtifact').mockResolvedValue({} as any);
    jest.spyOn(ManageAssetArtifactEvent.prototype, 'createArtifactEvent').mockResolvedValue({} as any);
    const ledgerOrgId = 'urn:org:tax:fallback-org';
    await registerOrganizationOnLedger({
      ledgerConfig: mockConfig.ledger,
      hostJurisdiction: mockConfig.host.jurisdiction,
      namespace: mockConfig.namespace,
      hostExternalDomain: mockConfig.hostExternalDomain,
      logger: mockLogger,
      orgId: 'legacy-fallback-id',
      organization: {
        id: 'urn:test:org:fallback',
        type: 'Organization',
        meta: {
          claims: {
            [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
            [ClaimsOrganizationSchemaorg.identifierValue]: 'fallback-org',
            [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
            [ClaimsOrganizationSchemaorg.alternateName]: 'fallback-org',
          },
        },
      } as any,
      config: {
        governanceVc: { id: 'urn:vc:governance:fallback' } as any,
        didDocument: {
          id: 'did:web:fallback.example.org',
          verificationMethod: [
            {
              id: 'did:web:fallback.example.org#sig-akp',
              publicKeyJwk: {
                kid: 'sig-akp',
                use: 'sig',
              } as any,
            },
            {
              id: 'did:web:fallback.example.org#enc-okp',
              publicKeyJwk: {
                kid: 'enc-okp',
                use: 'enc',
              } as any,
            },
          ],
        },
      } as any,
      role: 'tenant',
      sector: Sector.HEALTH_CARE,
      jurisdiction: 'ES',
    });

    expect(registerKeySpy).toHaveBeenNthCalledWith(1, 'Org1MSP', 'did:web:fallback.example.org#sig-akp', expect.objectContaining({
      keyId: 'did:web:fallback.example.org#sig-akp',
      kid: 'sig-akp',
      thumbprint: undefined,
    }));
    expect(registerKeySpy).toHaveBeenNthCalledWith(2, 'Org1MSP', 'did:web:fallback.example.org#enc-okp', expect.objectContaining({
      keyId: 'did:web:fallback.example.org#enc-okp',
      kid: 'enc-okp',
      thumbprint: undefined,
    }));
    expect(upsertBindingSpy).toHaveBeenNthCalledWith(1, 'Org1MSP', `organization_${ledgerOrgId}__did:web:fallback.example.org#sig-akp`, expect.objectContaining({
      subjectId: ledgerOrgId,
      keyId: 'did:web:fallback.example.org#sig-akp',
      meta: expect.objectContaining({
        attributes: expect.objectContaining({
          thumbprintMissing: true,
        }),
      }),
    }));
    expect(upsertBindingSpy).toHaveBeenNthCalledWith(2, 'Org1MSP', `organization_${ledgerOrgId}__did:web:fallback.example.org#enc-okp`, expect.objectContaining({
      subjectId: ledgerOrgId,
      keyId: 'did:web:fallback.example.org#enc-okp',
      meta: expect.objectContaining({
        attributes: expect.objectContaining({
          thumbprintMissing: true,
        }),
      }),
    }));
  });

  it('[5.1 TENANT] derives alternateName from identifier.value for legal organizations when omitted', async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();

    const { [ClaimsOrganizationSchemaorg.alternateName]: _ignored, ...claimsWithoutAlternateName } = testClaimsTenant1Registration;
    const job = testBaseJobForClaims(claimsWithoutAlternateName as ClaimsRecord);

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');

    const expectedAlternateName = String(claimsWithoutAlternateName[ClaimsOrganizationSchemaorg.identifierValue]);
    expect(entry.meta?.claims?.[ClaimsOrganizationSchemaorg.alternateName]).toBe(expectedAlternateName);

    const tenantVaultId = tenantUtils.getTenantVaultId(
      claimsWithoutAlternateName[ClaimsServiceSchemaorg.category] as Sector,
      expectedAlternateName,
    );
    const provisionalDoc = await vaultRepository.get(
      await mockTenantsCacheManager.getCollectionName('host') as string,
      tenantVaultId,
      getEnvSectionId('tenants')
    ) as ConfidentialStorageDoc;

    expect(provisionalDoc).toBeDefined();
    expect(provisionalDoc.content?.claims?.[ClaimsOrganizationSchemaorg.alternateName]).toBe(expectedAlternateName);
  });

  it("[3 DEMO: should use a non-UUID identifier directly in 'demo' mode", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const demoClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: testTenant1Data.member.admin1.mockedUuid };
    const job = testBaseJobForClaims(demoClaims);
    (uuidValidate as jest.Mock).mockReturnValue(false);

    const responsePayload = await hostingManager.process(job, 'demo');
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it("[2] TENANT: should generate a new UUID for an invalid identifier", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const invalidClaims = { ...testClaimsTenant1Registration, [ClaimsPersonSchemaorg.identifier]: 'invalid-uuid-format' };
    const job = testBaseJobForClaims(invalidClaims);
    (uuidValidate as jest.Mock).mockReturnValue(false);

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it("[4] TENANT: should generate a new UUID if identifier claim is missing", async () => {
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const { [ClaimsPersonSchemaorg.identifier]: _, ...noIdClaims } = testClaimsTenant1Registration;
    const job = testBaseJobForClaims(noIdClaims as ClaimsRecord);
    (uuidv4 as jest.Mock).mockReturnValue('new-mocked-uuid-v4');

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];
    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-registration-offer-v1.0');
  });

  it("[6] TENANT: should produce an error entry for an invalid alternateName format", async () => {
    const job = testBaseJobForClaims(testClaimsTenant1AlternateNameInvalidPrefix);

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Invalid alternateName');
  });

  it("[7] TENANT: should produce an error entry if vaultId already exists", async () => {
    const vaultExistsSpy = jest.spyOn(vaultRepository, 'vaultExists').mockResolvedValue(true);
    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    const responsePayload = await hostingManager.process(job);

    const sector = testClaimsTenant1Registration[ClaimsServiceSchemaorg.category] as Sector;
    const alternateName = testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.alternateName];
    const expectedVaultId = tenantUtils.getTenantVaultId(sector, alternateName);

    expect(vaultExistsSpy).toHaveBeenCalledWith(expectedVaultId);
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(`a vault for '${expectedVaultId}' already exists`);
  });
  
  it("[8 TENANT: should produce an error entry if identifier and country combination already exists", async () => {
    // PRE-CONDITION: Ensure host vault exists
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    
    // Arrange: Simulate that the vault for this tenant already exists.
    jest.spyOn(vaultRepository, 'vaultExists').mockResolvedValue(true);
    
    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    // Act
    const responsePayload = await hostingManager.process(job);

    // Assert
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('already exists');
  });

  it('[9] TENANT: should produce an error entry if sector claim contains multiple values', async () => {
    const claimsWithMultipleSectors = {
      ...testClaimsTenant1Registration,
      [ClaimsServiceSchemaorg.category]: 'health-care,insurance',
    };
    const job = testBaseJobForClaims(claimsWithMultipleSectors);
    
    const responsePayload = await hostingManager.process(job);
    
    const errorEntry = responsePayload.body.data[0];
    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('Multiple sectors (comma-separated) are not allowed');
    expect(errorEntry.response.outcome.issue[0].code).toBe('value');
  });

  it('[10] TENANT: should persist all original claims in the tenant configuration', async () => {
    // PRE-CONDITION: Ensure host vault exists before creating a tenant.
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    const initialProtectCalls = mockKmsService.protectConfidentialData.mock.calls.length;

    const job = testBaseJobForClaims(testClaimsTenant1Registration);

    await hostingManager.process(job);

    // In the Offer/Order flow, only a provisional document is created initially.
    // We expect one call to protect this provisional document.
    expect(mockKmsService.protectConfidentialData).toHaveBeenCalledTimes(initialProtectCalls + 1);

    // The call should be for the tenant's provisional registration document.
    const docToProtect = mockKmsService.protectConfidentialData.mock.calls[initialProtectCalls][0];
    const provisionalConfig = docToProtect.content as EntityConfig;

    expect(provisionalConfig.claims).toBeDefined();
    const claims = provisionalConfig.claims as ClaimsRecord;

    // Check that all original claims are preserved in the provisional record.
    expect(claims[ClaimsOrganizationSchemaorg.legalName]).toBe(
      testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.legalName],
    );
    expect(claims[ClaimsServiceSchemaorg.category]).toBe(
      testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
    );
    expect(claims[ClaimsPersonSchemaorg.email]).toBe(testClaimsTenant1Registration[ClaimsPersonSchemaorg.email]);
  });
});
