import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { IServerConfig } from '../../../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import { ILogger } from '../../../loggers/ILogger';
import { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { LifecycleRequestType } from 'gdc-common-utils-ts/constants/lifecycle';
import { testClaimsHostInitialization, testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { testDefaultHostServiceTypeClaim } from '../../data/organization.data';
import { ORGANIZATION_ORDER_REQUEST } from '../../data/example-payloads';
import * as tenantUtils from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { getTenantAuthorizationLifecycle } from '../../../utils/tenant-lifecycle';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import type { IHostRuntime } from '../../../managers/IHostRuntime';

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
            category: testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
            serviceType: testClaimsTenant1Registration[ClaimsServiceSchemaorg.serviceType],
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
  let hostRuntime: IHostRuntime;
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
    hostRuntime = {
      hostCollectionName,
      hostDid: 'did:web:testhost.com',
    };

    mockConfig = {
      securityMode: 'compat',
      networkMode: 'test-network',
      fhirLegacy: false,
      jsonLegacy: false,
      didcommPlainEnabled: true,
      demoAllowInsecureBearer: false,
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

    hostingManager = new HostingManager(
      vaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      mockConfig,
      hostRuntime,
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
              taxID: 'VATES-B00112233',
              category: testClaimsTenant1Registration[ClaimsServiceSchemaorg.category],
              serviceType: testClaimsTenant1Registration[ClaimsServiceSchemaorg.serviceType],
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

  function buildLifecycleJob(action: '_disable' | '_enable' | '_purge'): JobRequest {
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
              type: action === '_disable'
                ? LifecycleRequestType.TenantDisable
                : action === '_enable'
                  ? LifecycleRequestType.TenantEnable
                  : LifecycleRequestType.TenantPurge,
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

  function buildControllerProofBearerPayload(input?: {
    representativeDid?: string;
    memberOfTaxId?: string;
    roleCode?: string;
  }): Record<string, unknown> {
    const representativeDid = input?.representativeDid || 'did:web:controller.example.com';
    return {
      iss: representativeDid,
      sub: representativeDid,
      vp: {
        verifiableCredential: [
          {
            '@context': ['https://www.w3.org/2018/credentials/v1'],
            type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
            credentialSubject: {
              id: representativeDid,
              memberOf: {
                taxID: input?.memberOfTaxId || String(testClaimsTenant1Registration[ClaimsOrganizationSchemaorg.identifierValue]),
              },
              hasOccupation: {
                identifier: {
                  value: input?.roleCode || 'RESPRSN',
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
  }

  function buildHostLifecycleJob(action: '_disable' | '_purge'): JobRequest {
    return {
      id: `host-${action}-job-id`,
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
        thid: `host-${action}-thid`,
        jti: `host-${action}-jti`,
        type: 'json',
        body: {
          data: [
            {
              type: action === '_disable'
                ? LifecycleRequestType.TenantDisable
                : LifecycleRequestType.TenantPurge,
              meta: {
                claims: {
                  [ClaimsOrganizationSchemaorg.identifierValue]: testClaimsHostInitialization[ClaimsOrganizationSchemaorg.identifierValue],
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

  async function putEmployeeLifecycleDoc(
    tenantCollectionName: string,
    employeeId: string,
    status: EntityLifecycleStatus,
    meta: Record<string, unknown> = {},
  ): Promise<void> {
    await vaultRepository.put(
      tenantCollectionName,
      [{
        id: employeeId,
        status,
        sequence: 0,
        content: {
          id: employeeId,
          status,
          meta,
          claims: {},
        },
      } as ConfidentialStorageDoc],
      getEnvSectionId('employees'),
    );
  }

  it('should activate a tenant from ICA proof and persist the final tenant config', async () => {
    const job = buildActivationJob();
    const expectedControllerKid = toJwkThumbprintSha256Urn(job.content!.meta!.jws!.protected!.jwk as any);

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
    expect((employeeDocs[0] as any).content?.didDocument?.verificationMethod?.[0]?.publicKeyJwk?.kid).toBe(expectedControllerKid);
    // Legacy GlobalDataCare activation derives the controller DID from the
    // verified representative when no explicit controller binding is sent.
    expect(finalDoc.content!.didDocument.controller).toEqual([
      (employeeDocs[0] as any).content?.didDocument?.id,
    ]);

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

  /**
   * Producer + consumer contract guard for legacy `_activate`.
   *
   * This test exists to stop a false-green path where activation still returns
   * `201` but the code silently drops `org.schema.Offer.identifier`.
   * If that happens, the follow-up Order contract is already broken even before
   * the caller reaches `Order/_batch`.
   */
  it('should expose the canonical org.schema.Offer.identifier in _activate and require that exact value for the follow-up Order', async () => {
    const activationResponse = await hostingManager.process(buildActivationJob());
    const activationClaims = activationResponse.body.data[0].meta?.claims as Record<string, unknown>;
    const canonicalOfferId = activationClaims[ClaimsOfferSchemaorg.identifier];
    const offerId = String(canonicalOfferId || '');

    expect(activationResponse.body.data[0].type).toBe('Organization-activation-response-v1.0');
    expect(canonicalOfferId).toBeDefined();
    expect(typeof canonicalOfferId).toBe('string');
    expect(offerId).toContain(':Offer:');

    const orderJob: JobRequest = {
      id: 'activation-order-job-id',
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      tenantId: 'host',
      jurisdiction: 'es',
      sector: 'test-network' as Sector,
      section: 'registry',
      format: 'org.schema',
      action: '_batch',
      resourceType: 'Order',
      content: structuredClone(ORGANIZATION_ORDER_REQUEST) as any,
      httpMethod: 'POST',
      requestUrl: '/host/cds-es/v1/test-network/registry/org.schema/Order/_batch',
    };
    orderJob.content!.body.data[0].meta.claims[ClaimsOrderSchemaorg.acceptedOfferIdentifier] = offerId;
    orderJob.content!.body.data[0].meta.claims[ClaimsOrderSchemaorg.paymentMethod] = 'Stripe';
    orderJob.content!.body.data[0].meta.claims[ClaimsOrderSchemaorg.partOfInvoice] = 'in_activation_follow_up';

    const orderResponse = await hostingManager.process(orderJob);

    expect(orderResponse.body.data[0].response.status).toBe('200');
    expect(
      orderResponse.body.data[0].meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier],
    ).toBe(offerId);
  });

  it('should activate when the representative credential uses a non-did credentialSubject.id', async () => {
    const job = buildActivationJob();
    (job.content!.body as any).representativeCredential.credentialSubject.id = 'urn:person:identifier:controller-001';

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.meta.claims['org.schema.Organization.did']).toBe('did:web:api.acme.org');
  });

  it('keeps the scoped historical representative as the first controller without requiring legacy RESPRSN', async () => {
    const job = buildActivationJob();
    const credential = (job.content!.body as any).representativeCredential;
    credential.id = 'urn:example:credential:historical-representative';
    credential.issuer = 'did:web:ica.example.test';
    credential.type = ['VerifiableCredential', 'LegalRepresentativeCredential'];
    credential.credentialSubject.memberOf = { taxID: 'VATES-B00112233' };
    credential.credentialSubject.hasOccupation = {
      identifier: 'urn:ilo:ilostat:isco-08:1120',
    };
    delete credential.credentialSubject.hasCredential;

    const claims = job.content!.body!.data[0]!.meta!.claims;
    process.env.HOST_LEGACY_CONTROLLER_SCOPES = `${claims[ClaimsOrganizationSchemaorg.alternateName]}|${claims[ClaimsServiceSchemaorg.category]}`;
    try {
      const responsePayload = await hostingManager.process(job);
      expect(responsePayload.body.data[0].response.status).toBe('201');

      const tenantVaultId = tenantUtils.getTenantVaultId(
        claims[ClaimsServiceSchemaorg.category] as Sector,
        claims[ClaimsOrganizationSchemaorg.alternateName] as string,
      );
      const tenantDoc = await vaultRepository.get(
        hostCollectionName,
        tenantVaultId,
        getEnvSectionId('tenants'),
      ) as ConfidentialStorageDoc;
      expect(tenantDoc.content?.didDocument?.controller).toHaveLength(1);

      const legacyControllerDid = tenantDoc.content?.didDocument?.controller?.[0];
      const serviceControllerDid = 'did:web:api.acme.org:controllers:service-controller';
      tenantDoc.content!.didDocument.controller = [legacyControllerDid, serviceControllerDid];
      await vaultRepository.put(hostCollectionName, [tenantDoc], getEnvSectionId('tenants'));

      const tenantCollectionName = tenantUtils.generateTenantCollectionNameFromClaims({
        ...claims,
        [ClaimsOrganizationSchemaorg.url]: 'https://api.acme.org',
      } as any);
      const beforeRotation = await vaultRepository.getContainersInSection(
        tenantCollectionName,
        getEnvSectionId('employees'),
      );
      const oldKids = ((beforeRotation[0] as any).content?.didDocument?.verificationMethod || [])
        .map((method: any) => method.publicKeyJwk?.kid);

      // A verified re-registration may carry renewed credentials and new
      // portal keys. It replaces only this stable legacy controller document;
      // the independently registered service controller remains untouched.
      (job.content!.meta as any).jws.protected = {
        alg: 'ML-DSA-44',
        kid: 'controller-sig-kid-rotated',
        jwk: { kty: 'AKP', alg: 'ML-DSA-44', pub: 'controller-sig-pub-rotated' },
      };
      (job.content!.meta as any).jwe.header = {
        enc: 'A256GCM',
        skid: 'controller-enc-kid-rotated',
        jwk: { kty: 'OKP', crv: 'ML-KEM-768', x: 'controller-enc-x-rotated' },
      };
      const reRegistrationResponse = await hostingManager.process(job);
      expect(reRegistrationResponse.body.data[0].response.status).toBe('200');
      expect(reRegistrationResponse.body.data[0].meta?.claims?.[ClaimsOfferSchemaorg.identifier]).toBeUndefined();
      const reRegisteredTenantDoc = await vaultRepository.get(
        hostCollectionName,
        tenantVaultId,
        getEnvSectionId('tenants'),
      ) as ConfidentialStorageDoc;
      expect(reRegisteredTenantDoc.content?.didDocument?.controller).toEqual([
        legacyControllerDid,
        serviceControllerDid,
      ]);
      const afterRotation = await vaultRepository.getContainersInSection(
        tenantCollectionName,
        getEnvSectionId('employees'),
      );
      expect(afterRotation).toHaveLength(1);
      expect((afterRotation[0] as any).content?.didDocument?.id).toBe(legacyControllerDid);
      const rotatedMethods = (afterRotation[0] as any).content?.didDocument?.verificationMethod || [];
      expect(rotatedMethods.some((method: any) => method.publicKeyJwk?.pub === 'controller-sig-pub-rotated')).toBe(true);
      expect(rotatedMethods.map((method: any) => method.publicKeyJwk?.kid)).not.toEqual(oldKids);
    } finally {
      delete process.env.HOST_LEGACY_CONTROLLER_SCOPES;
    }
  });

  it('should apply demo representative binding fallback from meta.jws when ICA omits hasCredential', async () => {
    const job = buildActivationJob();
    mockConfig.securityMode = 'demo';
    delete (job.content!.body as any).representativeCredential.credentialSubject.hasCredential;

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');

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
    expect((proofDoc as any)?.content?.representativeCredential?.credentialSubject?.hasCredential?.material).toBe(
      toJwkThumbprintSha256Urn((job.content!.meta as any).jws.protected.jwk),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('demo-only representative hasCredential.material fallback'),
    );
  });

  it('should backfill addressCountry before tenant vault creation instead of crashing activation', async () => {
    const job = buildActivationJob();
    mockConfig.securityMode = 'demo';
    const activationClaims = { ...job.content!.body!.data[0]!.meta!.claims } as Record<string, unknown>;
    delete activationClaims[ClaimsOrganizationSchemaorg.addressCountry];
    job.content!.body!.data[0]!.meta!.claims = activationClaims;

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');

    const claims = entry.meta.claims;
    const tenantCollectionName = tenantUtils.generateTenantCollectionNameFromClaims({
      ...claims,
      [ClaimsOrganizationSchemaorg.url]: 'https://api.acme.org',
    } as any);
    const tenantDoc = await vaultRepository.get(
      hostCollectionName,
      tenantUtils.getTenantVaultId(
        claims[ClaimsServiceSchemaorg.category] as Sector,
        claims[ClaimsOrganizationSchemaorg.alternateName] as string,
      ),
      getEnvSectionId('tenants'),
    ) as ConfidentialStorageDoc;
    expect(tenantCollectionName).toBeDefined();
    expect(tenantDoc.content?.status).toBe('active');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.addressCountry]).toBe('ES');
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      'Unexpected error during registration processing:',
      expect.anything(),
    );
  });

  it('should derive organization identifier claims from taxID when activation claims omit them', async () => {
    const job = buildActivationJob();
    const activationClaims = { ...job.content!.body!.data[0]!.meta!.claims } as Record<string, unknown>;
    delete activationClaims[ClaimsOrganizationSchemaorg.alternateName];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifierValue];
    job.content!.body!.data[0]!.meta!.claims = activationClaims;

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.alternateName]).toBe('VATES-B00112233');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifierType]).toBe('TAX');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifierValue]).toBe('VATES-B00112233');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifier]).toBe(
      'urn:test-namespace:test-network:es:v1:health-care:entity:tax:VATES-B00112233',
    );
  });

  it('should derive addressCountry from activation route jurisdiction when claims omit it', async () => {
    const job = buildActivationJob();
    const activationClaims = { ...job.content!.body!.data[0]!.meta!.claims } as Record<string, unknown>;
    delete activationClaims[ClaimsOrganizationSchemaorg.addressCountry];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
    job.content!.body!.data[0]!.meta!.claims = activationClaims;

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.addressCountry]).toBe('ES');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifier]).toBe(
      'urn:test-namespace:test-network:es:v1:health-care:entity:tax:acme-id',
    );
  });

  it('should return OperationOutcome instead of crashing when activation URN inputs are still incomplete', async () => {
    const job = buildActivationJob({ jurisdiction: '' as any });
    const activationClaims = { ...job.content!.body!.data[0]!.meta!.claims } as Record<string, unknown>;
    delete activationClaims[ClaimsOrganizationSchemaorg.addressCountry];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifierValue];
    delete (job.content!.body as any).organizationCredential.credentialSubject.taxID;
    job.content!.body!.data[0]!.meta!.claims = activationClaims;

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];

    expect(errorEntry.response.status).toBe('400');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain(
      'Missing required claim(s) for activation organization URN',
    );
  });

  it('should default organization identifierType to UUID when identifierValue is a UUID', async () => {
    const job = buildActivationJob();
    const activationClaims = { ...job.content!.body!.data[0]!.meta!.claims } as Record<string, unknown>;
    delete activationClaims[ClaimsOrganizationSchemaorg.alternateName];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
    activationClaims[ClaimsOrganizationSchemaorg.identifierValue] = '123e4567-e89b-12d3-a456-426614174000';
    job.content!.body!.data[0]!.meta!.claims = activationClaims;
    uuidMock.validate.mockReturnValue(true);

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.alternateName]).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifierType]).toBe('UUID');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifierValue]).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifier]).toBe(
      'urn:test-namespace:test-network:es:v1:health-care:entity:uuid:123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('should prefer a distinct legal identifier over taxID when deriving alternateName', async () => {
    const job = buildActivationJob();
    const activationClaims = { ...job.content!.body!.data[0]!.meta!.claims } as Record<string, unknown>;
    delete activationClaims[ClaimsOrganizationSchemaorg.alternateName];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifier];
    delete activationClaims[ClaimsOrganizationSchemaorg.identifierType];
    activationClaims[ClaimsOrganizationSchemaorg.identifierValue] = 'BC1234567';
    job.content!.body!.data[0]!.meta!.claims = activationClaims;
    uuidMock.validate.mockReturnValue(false);

    const responsePayload = await hostingManager.process(job);
    const entry = responsePayload.body.data[0];

    expect(entry.response.status).toBe('201');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.alternateName]).toBe('BC1234567');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifierType]).toBe('TAX');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifierValue]).toBe('BC1234567');
    expect(entry.meta.claims[ClaimsOrganizationSchemaorg.identifier]).toBe(
      'urn:test-namespace:test-network:es:v1:health-care:entity:tax:BC1234567',
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

  it('should reject activation when ICA credential does not authorize the requested serviceType', async () => {
    const job = buildActivationJob();
    (job.content!.body as any).organizationCredential.credentialSubject.serviceType = testDefaultHostServiceTypeClaim;

    const responsePayload = await hostingManager.process(job);
    const errorEntry = responsePayload.body.data[0];

    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('does not authorize serviceType');
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
            kid: 'legacy-pontus-x-kid',
            kty: 'EC',
            crv: 'secp256k1',
            x: 'legacy-pontus-x',
            y: 'legacy-pontus-y',
            alg: 'ES256K',
            use: 'sig',
          },
          {
            kid: 'controller-pqc-kid',
            kty: 'AKP',
            alg: 'ML-DSA-65',
            pub: 'controller-pqc-public-key',
            use: 'sig',
          },
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
      hostRuntime,
    );
    await hostingManager.bootstrapHost(testClaimsHostInitialization);
    await mockTenantsCacheManager.loadHost();

    const job = buildActivationJob();
    const controllerSameAs = 'urn:multibase:zControllerHash';
    (job.content!.body as any).controller = {
      did: 'did:web:people.acme.org:controllers:primary',
      sameAs: controllerSameAs,
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
            kid: 'legacy-pontus-x-kid',
            kty: 'EC',
            crv: 'secp256k1',
            x: 'legacy-pontus-x',
            y: 'legacy-pontus-y',
            alg: 'ES256K',
            use: 'sig',
          },
          {
            kid: 'controller-pqc-kid',
            kty: 'AKP',
            alg: 'ML-DSA-65',
            pub: 'controller-pqc-public-key',
            use: 'sig',
          },
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

    const requestedController = (job.content!.body as any).controller;
    const expectedControllerKids = [
      requestedController.publicKeyJwk,
      ...requestedController.jwks.keys,
    ].map((key: any) => toJwkThumbprintSha256Urn(key));

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
    expect(controllerDidDocument.alsoKnownAs).toContain(controllerSameAs);
    expect(controllerDidDocument.verificationMethod?.[0]?.publicKeyJwk?.kid).toBe(expectedControllerKids[0]);
    expect(controllerDidDocument.verificationMethod.map((method: any) => method.publicKeyJwk.kid)).toEqual(
      expect.arrayContaining(expectedControllerKids.slice(0, 3)),
    );
    expect(controllerDidDocument.keyAgreement).toContain(`did:web:people.acme.org:controllers:primary#${expectedControllerKids[3]}`);

    const icaRequestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const icaOrganization = icaRequestBody.body?.data?.[0]?.resource?.organization;
    const icaController = icaRequestBody.body?.data?.[0]?.resource?.controller;
    expect(icaOrganization.didDocument.controller).toEqual(['did:web:people.acme.org:controllers:primary']);
    expect(icaController.publicKeyJwk.kid).toBe(expectedControllerKids[0]);
    expect(icaController.sameAs).toBe(controllerSameAs);
    expect(icaController.did).toBe('did:web:people.acme.org:controllers:primary');
    expect(icaController.jwks.keys.map((key: any) => key.kid)).toEqual(
      expect.arrayContaining(expectedControllerKids.slice(1)),
    );
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
      hostRuntime,
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

  it('should attribute tenant lifecycle changedBy to the controller proof bearer actor when present', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const disableJob = buildLifecycleJob('_disable');
    disableJob.content!.iss = 'did:web:portal.example.org';
    disableJob.content!.meta = {
      bearer: {
        jwt: {
          payload: buildControllerProofBearerPayload(),
        },
      },
    } as any;

    const disableResponse = await hostingManager.process(disableJob);
    expect(disableResponse.body.data[0].response.status).toBe('200');
    expect(disableResponse.body.data[0].meta.claims['org.schema.Action.tenantAuthorization.changedBy'])
      .toBe('did:web:controller.example.com');
  });

  it('should reject enable unless the tenant is currently disabled', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const response = await hostingManager.process(buildLifecycleJob('_enable'));
    const errorEntry = response.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('only be enabled from disabled');
  });

  it('should disable active employee descendants with the tenant', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const claims = activationJob.content!.body!.data[0]!.meta!.claims;
    const tenantVaultId = tenantUtils.getTenantVaultId(
      claims[ClaimsServiceSchemaorg.category] as Sector,
      claims[ClaimsOrganizationSchemaorg.alternateName],
    );
    await putEmployeeLifecycleDoc(
      tenantVaultId,
      'active-employee-1',
      EntityLifecycleStatus.Active,
    );

    const response = await hostingManager.process(buildLifecycleJob('_disable'));
    expect(response.body.data[0].response.status).toBe('200');
  });

  it('should purge disabled descendants with the tenant', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const claims = activationJob.content!.body!.data[0]!.meta!.claims;
    const tenantVaultId = tenantUtils.getTenantVaultId(
      claims[ClaimsServiceSchemaorg.category] as Sector,
      claims[ClaimsOrganizationSchemaorg.alternateName],
    );
    const disableResponse = await hostingManager.process(buildLifecycleJob('_disable'));
    expect(disableResponse.body.data[0].response.status).toBe('200');

    await putEmployeeLifecycleDoc(
      tenantVaultId,
      'inactive-employee-1',
      EntityLifecycleStatus.Inactive,
    );

    const response = await hostingManager.process(buildLifecycleJob('_purge'));
    expect(response.body.data[0].response.status).toBe('200');
  });

  it('should reject tenant disable when controller proof bearer memberOf.taxID does not match the target tenant', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const disableJob = buildLifecycleJob('_disable');
    disableJob.content!.iss = 'did:web:portal.example.org';
    disableJob.content!.meta = {
      bearer: {
        jwt: {
          payload: buildControllerProofBearerPayload({
            memberOfTaxId: 'DIFFERENT-TAX-ID',
          }),
        },
      },
    } as any;

    const response = await hostingManager.process(disableJob);
    const errorEntry = response.body.data[0];
    expect(errorEntry.response.status).toBe('403');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('memberOf.taxID');
  });

  it('should reject host disable while hosted tenant registrations remain', async () => {
    const activationJob = buildActivationJob();
    await hostingManager.process(activationJob);

    const response = await hostingManager.process(buildHostLifecycleJob('_disable'));
    const errorEntry = response.body.data[0];
    expect(errorEntry.response.status).toBe('409');
    expect(errorEntry.response.outcome.issue[0].diagnostics).toContain('hosted tenant registration(s) remain');
  });
});
