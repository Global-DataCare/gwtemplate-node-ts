import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../../data/end-to-end.data';
import * as tenantUtils from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { getTenantAuthorizationLifecycle } from '../../../utils/tenant-lifecycle';

const uuidMock = {
  v4: jest.fn(),
  validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { v4: uuidv4 } = await import('uuid');
const { HostingManager } = await import('../../../managers/HostingManager');

const mockStorageAdapter: jest.Mocked<IStorageAdapter> = {
  upload: jest.fn(),
};

const mockLogger: jest.Mocked<ILogger> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(async () => {}),
  provisionKeys: jest.fn() as jest.MockedFunction<IKmsService['provisionKeys']>,
  getPublicJwks: jest.fn() as jest.MockedFunction<IKmsService['getPublicJwks']>,
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc): Promise<ConfidentialStorageDoc> => {
    const secureDoc = { ...doc, jwe: { ciphertext: 'encrypted-content' }, content: doc.content };
    delete (secureDoc as any).protectedAttributes;
    return secureDoc;
  }),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => Promise.resolve(doc.content as any)),
  createDetachedJws: jest.fn(async () => 'mock-jws'),
  createCompactJws: jest.fn(),
  getHostPublicJwkSet: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(async (attributes) => attributes as any),
};

describe('HostingManager activation flow', () => {
  const vpPayloadWithCredentials = {
    sub: 'did:web:controller.example.com',
    vp: {
      verifiableCredential: [
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'OrganizationCredential'],
          credentialSubject: {
            id: 'did:web:api.acme.org',
            taxID: 'VATES-B00112233',
          },
        },
        {
          '@context': ['https://www.w3.org/2018/credentials/v1'],
          type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
          credentialSubject: {
            id: 'did:web:controller.example.com',
            memberOf: {
              taxID: 'VATES-B00112233',
            },
            hasOccupation: {
              identifier: {
                value: 'RESPRSN',
              },
            },
            hasCredential: {
              material: 'controller-sig-kid',
            },
          },
        },
      ],
    },
  };
  const vpTokenCompact = [
    Buffer.from(JSON.stringify({ alg: 'ML-DSA-44', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(vpPayloadWithCredentials)).toString('base64url'),
    'mock-signature',
  ].join('.');

  let hostingManager: InstanceType<typeof HostingManager>;
  let vaultRepository: VaultMemRepository;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;
  let mockConfig: IServerConfig;
  let hostCollectionName: string;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    jest.clearAllMocks();
    (uuidv4 as jest.Mock).mockReturnValue('activation-test-uuid');

    vaultRepository = new VaultMemRepository();
    hostCollectionName = tenantUtils.generateTenantCollectionNameFromClaims(testClaimsHostInitialization);
    mockTenantsCacheManager = new TenantsCacheManager(
      vaultRepository,
      () => mockKmsService,
      hostCollectionName,
    ) as jest.Mocked<TenantsCacheManager>;

    mockConfig = {
      securityMode: 'compat',
      networkMode: 'test-network',
      fhirLegacy: false,
      jsonLegacy: false,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: false,
      nodeEnv: 'test',
      port: 3000,
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

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
    );

    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [
        { kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44' } as any,
        { kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768' } as any,
      ],
    });
    mockKmsService.provisionKeys.mockResolvedValue({
      keys: [
        { kty: 'AKP', kid: 'sig-key-1', use: 'sig', alg: 'ML-DSA-44', pub: 'tenant-sig-pub' },
        { kty: 'OKP', kid: 'enc-key-1', use: 'enc', crv: 'ML-KEM-768', x: 'tenant-enc-x' },
      ],
    } as any);

    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function buildActivationJob(overrides?: Partial<JobRequest>): JobRequest {
    return {
      id: 'activation-job-id',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: 'host',
      jurisdiction: 'es',
      sector: 'test-network' as Sector,
      section: 'registry',
      format: 'org.schema',
      action: '_activate',
      resourceType: 'Organization',
      content: {
        iss: 'did:web:controller.example.com',
        aud: 'did:web:testhost.com',
        thid: 'activation-thid',
        jti: 'activation-jti',
        type: 'json',
        body: {
          vp_token: vpTokenCompact,
          organizationCredential: {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential'],
            credentialSubject: {
              id: 'did:web:api.acme.org',
            },
          },
          representativeCredential: {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential'],
            credentialSubject: {
              id: 'did:web:controller.example.com',
              hasOccupation: {
                identifier: {
                  value: 'RESPRSN',
                },
              },
              hasCredential: {
                material: 'controller-sig-kid',
              },
            },
          },
          data: [
            {
              type: 'Organization-activation-request-v1.0',
              meta: {
                claims: { ...testClaimsTenant1Registration },
              },
              request: { method: 'POST' },
              resource: {},
            },
          ],
        },
        meta: {
          jws: {
            protected: {
              alg: 'ML-DSA-44',
              kid: 'controller-sig-kid',
              jwk: { kty: 'AKP', alg: 'ML-DSA-44', pub: 'controller-sig-pub' },
            },
          },
          jwe: {
            header: {
              enc: 'A256GCM',
              skid: 'controller-enc-kid',
              jwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'controller-enc-x' },
            },
          },
        } as any,
      } as any,
      httpMethod: 'POST',
      requestUrl: '/host/cds-es/v1/test-network/registry/org.schema/Organization/_activate',
      ...overrides,
    };
  }

  function buildLifecycleJob(action: '_disable' | '_enable'): JobRequest {
    return {
      id: `${action}-job-id`,
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: 'host',
      jurisdiction: 'es',
      sector: 'test-network' as Sector,
      section: 'registry',
      format: 'org.schema',
      action,
      resourceType: 'Organization',
      content: {
        iss: 'did:web:host.example.com',
        aud: 'did:web:testhost.com',
        thid: `${action}-thid`,
        jti: `${action}-jti`,
        type: 'json',
        body: {
          data: [
            {
              type: action === '_disable' ? 'Organization-disable-request-v1.0' : 'Organization-enable-request-v1.0',
              meta: {
                claims: {
                  [ClaimsOrganizationSchemaorg.identifierValue]: testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue],
                },
              },
              request: { method: 'POST' },
              resource: {},
            },
          ],
        },
        meta: {},
      } as any,
      httpMethod: 'POST',
      requestUrl: `/host/cds-es/v1/test-network/registry/org.schema/Organization/${action}`,
    };
  }

  it('should activate a tenant from ICA proof and persist the final tenant config', async () => {
    const job = buildActivationJob();

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.type).toBe('Organization-activation-response-v1.0');
    expect(entry.meta.claims['org.schema.Organization.did']).toBe('did:web:api.acme.org');
    expect(entry.meta.claims['org.schema.Action.activation.networkMode']).toBe('test-network');
    expect(entry.meta.claims['org.schema.Action.activation.revocationChecked']).toBe('true');
    expect(entry.meta.claims['org.schema.Action.activation.onChainChecked']).toBe('false');

    const claims = job.content!.body!.data[0]!.meta!.claims;
    const tenantVaultId = tenantUtils.getTenantVaultId(
      claims[ClaimsServiceSchemaorg.category] as Sector,
      claims[ClaimsOrganizationSchemaorg.alternateName],
    );
    const finalDoc = await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    ) as ConfidentialStorageDoc;
    expect(finalDoc).toBeDefined();
    expect(finalDoc.content).toBeDefined();
    expect(finalDoc.content!.status).toBe('active');
    expect(finalDoc.content!.didDocument.id).toBe('did:web:api.acme.org');
    expect(finalDoc.content!.networkStatus[0].networkName).toBe('test-network');
    expect(getTenantAuthorizationLifecycle(finalDoc.content)?.status).toBe('active');

    const tenantCollectionName = tenantUtils.generateTenantCollectionNameFromClaims({
      ...claims,
      [ClaimsOrganizationSchemaorg.url]: 'https://api.acme.org',
    } as any);
    const legalParticipantDoc = await vaultRepository.get(
      tenantCollectionName,
      'legal-participant.vc.json',
      getEnvSectionId('.well-known'),
    );
    expect((legalParticipantDoc as any)?.content?.credentialSubject?.id).toBe('did:web:api.acme.org');

    const employeeDocs = await vaultRepository.getContainersInSection(
      tenantCollectionName,
      getEnvSectionId('employees'),
    );
    expect(employeeDocs.length).toBe(1);
    expect((employeeDocs[0] as any).content?.didDocument?.verificationMethod?.[0]?.publicKeyJwk?.kid).toBe('controller-sig-kid');

    const proofDoc = await vaultRepository.get(
      tenantCollectionName,
      'activation-proof.json',
      getEnvSectionId('proofs'),
    );
    expect((proofDoc as any)?.content?.vp_token).toBe(vpTokenCompact);
    expect((proofDoc as any)?.content?.trustPolicy?.networkMode).toBe('test-network');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('_activate received deprecated legacy compatibility field(s): organizationCredential, representativeCredential'),
    );
  });

  it('should reject activation when vp_token is missing', async () => {
    const job = buildActivationJob();
    delete (job.content!.body as any).vp_token;

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];

    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('vp_token');
  });

  it('should not warn about deprecated activation credential side-fields when only vp_token + controller.* are used', async () => {
    const job = buildActivationJob();
    delete (job.content!.body as any).organizationCredential;
    delete (job.content!.body as any).representativeCredential;
    (job.content!.body as any).controller = {
      did: 'did:web:people.acme.org:controllers:primary',
      publicKeyJwk: {
        kid: 'explicit-controller-sig-kid',
        kty: 'EC',
        crv: 'P-384',
        x: 'explicit-controller-sig-x',
        y: 'explicit-controller-sig-y',
        alg: 'ES384',
        use: 'sig',
      },
      jwks: {
        keys: [
          {
            kid: 'explicit-controller-enc-kid',
            kty: 'EC',
            crv: 'P-384',
            x: 'explicit-controller-enc-x',
            y: 'explicit-controller-enc-y',
            use: 'enc',
            purposes: ['didcomm-enc'],
          },
        ],
      },
    };

    const responsePayload = await hostingManager.process(job);
    expect(responsePayload.body.data[0].response.status).toBe('201');
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('_activate received deprecated legacy compatibility field(s):'),
    );
  });

  it('should prefer explicit controller signing material over DIDComm transport metadata', async () => {
    const fetchMock = jest.fn() as any;
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ status: 'approved' }),
    });
    global.fetch = fetchMock;
    mockConfig.ica = {
      mode: 'external',
      externalUrl: 'https://ica.example.com',
    };
    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();

    const job = buildActivationJob();
    (job.content!.body as any).controller = {
      did: 'did:web:people.acme.org:controllers:primary',
      sameAs: 'mailto:controller@acme.org',
      publicKeyJwk: {
        kid: 'explicit-controller-sig-kid',
        kty: 'EC',
        crv: 'P-384',
        x: 'explicit-controller-sig-x',
        y: 'explicit-controller-sig-y',
        alg: 'ES384',
        use: 'sig',
      },
      jwks: {
        keys: [
          {
            kid: 'explicit-controller-enc-kid',
            kty: 'EC',
            crv: 'P-384',
            x: 'explicit-controller-enc-x',
            y: 'explicit-controller-enc-y',
            use: 'enc',
            purposes: ['didcomm-enc'],
          },
        ],
      },
    };

    const responsePayload = await hostingManager.process(job);
    expect(responsePayload.body.data[0].response.status).toBe('201');

    const claims = job.content!.body!.data[0]!.meta!.claims;
    const tenantCollectionName = tenantUtils.generateTenantCollectionNameFromClaims({
      ...claims,
      [ClaimsOrganizationSchemaorg.url]: 'https://api.acme.org',
    } as any);
    const employeeDocs = await vaultRepository.getContainersInSection(
      tenantCollectionName,
      getEnvSectionId('employees'),
    );
    expect(employeeDocs.length).toBe(1);

    const controllerDidDocument = (employeeDocs[0] as any).content?.didDocument;
    expect(controllerDidDocument.id).toBe('did:web:people.acme.org:controllers:primary');
    expect(controllerDidDocument.alsoKnownAs).toContain('mailto:controller@acme.org');
    expect(controllerDidDocument.verificationMethod?.[0]?.publicKeyJwk?.kid).toBe('explicit-controller-sig-kid');
    expect(controllerDidDocument.keyAgreement).toContain('did:web:people.acme.org:controllers:primary#explicit-controller-enc-kid');

    const icaRequestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(icaRequestBody.controller.publicKeyJwk.kid).toBe('explicit-controller-sig-kid');
    expect(icaRequestBody.controller.sameAs).toBe('mailto:controller@acme.org');
    expect(icaRequestBody.controller.jwks.keys[0].kid).toBe('explicit-controller-enc-kid');
  });

  it('should poll ICA DID creation when remote endpoint responds 202', async () => {
    mockConfig.ica = {
      mode: 'external',
      externalUrl: 'https://ica.example.com',
    };
    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();

    const fetchMock = jest.fn() as any;
    fetchMock.mockImplementationOnce(async () => ({
      status: 202,
      ok: false,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'location' ? 'https://ica.example.com/entity/did/document/_create-response?thid=abc' : null),
      },
    }));
    fetchMock.mockImplementationOnce(async () => ({
      status: 200,
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
      json: async () => ({ status: 'approved', didDocumentId: 'did:web:api.acme.org' }),
    }));
    global.fetch = fetchMock;

    const job = buildActivationJob();
    const responsePayload = await hostingManager.process(job);

    expect(responsePayload.body.data[0].response.status).toBe('201');
    expect((global.fetch as jest.Mock).mock.calls).toHaveLength(2);

    const claims = job.content!.body!.data[0]!.meta!.claims;
    const tenantCollectionName = tenantUtils.generateTenantCollectionNameFromClaims({
      ...claims,
      [ClaimsOrganizationSchemaorg.url]: 'https://api.acme.org',
    } as any);
    const proofDoc = await vaultRepository.get(
      tenantCollectionName,
      'activation-proof.json',
      getEnvSectionId('proofs'),
    );
    expect((proofDoc as any)?.content?.icaDidRegistration?.status).toBe('approved');
  });

  it('should disable and enable an activated tenant authorization', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const disableResponse = await hostingManager.process(buildLifecycleJob('_disable'));
    expect(disableResponse.body.data[0].response.status).toBe('200');
    expect(disableResponse.body.data[0].meta.claims['org.schema.Action.tenantAuthorization.status']).toBe('suspended');

    const claims = activationJob.content!.body!.data[0]!.meta!.claims;
    const tenantVaultId = tenantUtils.getTenantVaultId(
      claims[ClaimsServiceSchemaorg.category] as Sector,
      claims[ClaimsOrganizationSchemaorg.alternateName],
    );
    const disabledDoc = await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    ) as ConfidentialStorageDoc;
    expect(getTenantAuthorizationLifecycle(disabledDoc.content)?.status).toBe('suspended');

    const enableResponse = await hostingManager.process(buildLifecycleJob('_enable'));
    expect(enableResponse.body.data[0].response.status).toBe('200');
    expect(enableResponse.body.data[0].meta.claims['org.schema.Action.tenantAuthorization.status']).toBe('active');

    const enabledDoc = await vaultRepository.get(
      hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    ) as ConfidentialStorageDoc;
    expect(getTenantAuthorizationLifecycle(enabledDoc.content)?.status).toBe('active');
  });

  it('should reject enable unless the tenant is currently disabled', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const response = await hostingManager.process(buildLifecycleJob('_enable'));
    const errorEntry = response.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('only be enabled from disabled');
  });
});
