import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE } from 'gdc-common-utils-ts/utils/didcomm-submit';
import {
  getLegalOrganizationVerificationController,
  getLegalOrganizationVerificationRepresentativePayload,
} from 'gdc-common-utils-ts/utils/legal-organization-verification-transaction';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { IServerConfig } from '../../../config';
import type { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import type { ILogger } from '../../../loggers/ILogger';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IHostRuntime } from '../../../managers/IHostRuntime';
import { ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST } from '../../data/example-payloads';
import { testClaimsRegisterTenantExpanded } from '../../data/organization.data';

const { HostingManager } = await import('../../../managers/HostingManager');
const EXAMPLE_SECTOR = Sector.HEALTH_CARE;
const EXAMPLE_HOST_COLLECTION = 'system_host';
const EXAMPLE_HOST_DID = 'did:web:host.example.org';
const EXAMPLE_ICA_BASE_URL = 'https://ica.example.org';
const EXAMPLE_ICA_POLL_URL = 'https://ica.example.org/poll/legal-org-verify';
const EXAMPLE_TENANT_ALTERNATE_NAME = 'acme-health';
const EXAMPLE_REQUEST_URL = '/host/cds-es/v1/test-network/registry/org.schema/Organization/_transaction';
const EXAMPLE_VERIFY_RESOURCE_TYPE = 'contract';
const EXAMPLE_TRANSACTION_RESPONSE_TYPE = 'Organization-verification-transaction-response-v1.0';
const EXAMPLE_NEXT_ACTION = 'Order/_batch';
const EXAMPLE_REQUEST_CONTENT_TYPE = DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE;
const EXAMPLE_ICA_RESPONSE_CONTENT_TYPE = 'application/json';
const EXAMPLE_ICA_VERIFY_RESPONSE_TYPE = 'VerifyResponse-v1.0';
const EXAMPLE_RESPONSE_STATUS_OK = '200';
const EXAMPLE_RESPONSE_STATUS_ACCEPTED = 202;
const EXAMPLE_ICA_RESPONSE_BUNDLE_TYPE = 'batch-response';
const EXAMPLE_TRANSACTION_BUNDLE_TYPE = 'transaction-response';

const mockVaultRepository = {
  vaultExists: jest.fn(async () => false),
  put: jest.fn(async () => undefined),
} as unknown as IVaultRepository;
const mockKmsService = {
  protectConfidentialData: jest.fn(async (doc: unknown) => doc),
} as unknown as IKmsService;
const mockTenantsCacheManager = {} as TenantsCacheManager;
const mockStorageAdapter = {} as IStorageAdapter;
const mockLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as ILogger;
const mockHostRuntime = {
  hostCollectionName: EXAMPLE_HOST_COLLECTION,
  hostDid: EXAMPLE_HOST_DID,
} as IHostRuntime;

const originalFetch = global.fetch;

function buildConfig(): IServerConfig {
  return {
    securityMode: 'demo',
    networkMode: 'test',
    fhirLegacy: false,
    jsonLegacy: false,
    didcommPlainEnabled: true,
    demoAllowInsecureBearer: true,
    nodeEnv: 'test',
    port: 3000,
    apiHostname: 'testhost',
    hostExternalDomain: 'host.example.org',
    apiBaseUrl: 'https://host.example.org',
    namespace: 'test',
    sectorsAllowed: [EXAMPLE_SECTOR],
    allowedPaymentMethods: ['bank-transfer'],
    dbProvider: 'mem',
    storageProvider: 'mem',
    queueProvider: 'mem',
    host: {
      jurisdiction: 'ES',
    },
    mongo: {
      dbName: 'test',
    },
    firebase: {},
    ica: {
      mode: 'external',
      externalUrl: EXAMPLE_ICA_BASE_URL,
      jurisdiction: 'ES',
    },
  };
}

function buildTransactionJob(): JobRequest {
  const requestBody = JSON.parse(JSON.stringify(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body));
  requestBody.data[0].meta.claims = {
    ...testClaimsRegisterTenantExpanded,
    ...requestBody.data[0].meta.claims,
    'org.schema.Organization.alternateName': EXAMPLE_TENANT_ALTERNATE_NAME,
  };
  return {
    tenantId: 'host',
    jurisdiction: 'es',
    sector: 'test-network',
    section: 'registry',
    format: 'org.schema',
    resourceType: 'Organization',
    action: '_transaction',
    requestUrl: EXAMPLE_REQUEST_URL,
    content: {
      jti: 'legal-organization-verification-request-001',
      thid: 'legal-organization-verification-thread-001',
      iss: 'did:web:portal.example.org',
      aud: 'did:web:host.example.org',
      type: 'application/api+json',
      body: requestBody,
      attachments: ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.attachments,
      meta: {
        jws: {
          protected: {
            alg: 'ES384',
            kid: 'portal-runtime-signing-key-001',
          },
        },
      },
    } as any,
  } as JobRequest;
}

function buildIcaVerifyResponse() {
  return {
    resourceType: 'Bundle',
    type: EXAMPLE_ICA_RESPONSE_BUNDLE_TYPE,
    data: [{
      type: EXAMPLE_ICA_VERIFY_RESPONSE_TYPE,
      resource: {
        sector: EXAMPLE_SECTOR,
      },
    }],
  };
}

describe('HostingManager legal organization verification transaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards host Organization/_transaction to ICA _verify and wraps the ICA response', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const icaVerifyResponse = buildIcaVerifyResponse();
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const response = await manager.process(buildTransactionJob(), 'test', false);

    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
    expect(fetchCalls[1]?.url).toBe(EXAMPLE_ICA_POLL_URL);
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      'content-type': EXAMPLE_REQUEST_CONTENT_TYPE,
    });

    const sentBody = JSON.parse(String(fetchCalls[0]?.init?.body || '{}'));
    expect(getLegalOrganizationVerificationController(sentBody.body)?.publicKeyJwk).toEqual(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body.data[0]?.resource?.controller?.publicKeyJwk,
    );
    expect(getLegalOrganizationVerificationRepresentativePayload(sentBody.body)?.email).toBe(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body.data[0]?.resource?.legalRepresentativePayload?.email,
    );
    expect(sentBody.attachments?.[0]?.data?.links?.[0]).toBe(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.attachments?.[0]?.data?.links?.[0],
    );
    expect(sentBody.body.data[0]?.meta?.claims?.[ClaimsServiceSchemaorg.serviceType]).toBe(
      testClaimsRegisterTenantExpanded[ClaimsServiceSchemaorg.serviceType],
    );

    expect(response.body.type).toBe(EXAMPLE_TRANSACTION_BUNDLE_TYPE);
    expect(response.body.data[0]?.type).toBe(EXAMPLE_TRANSACTION_RESPONSE_TYPE);
    expect(response.body.data[0]?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
    expect(response.body.data[0]?.resource?.icaResponse).toEqual(icaVerifyResponse);
    expect(
      response.body.data[0]?.meta?.claims?.[ClaimsServiceSchemaorg.category],
    ).toBe(EXAMPLE_SECTOR);
    const offerId = String(response.body.data[0]?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');
    expect(offerId).toContain(':Offer:');
    expect(response.body.data[0]?.resource?.next).toEqual({
      action: EXAMPLE_NEXT_ACTION,
      acceptedOffer: {
        identifier: offerId,
        identifierClaim: ClaimsOrderSchemaorg.acceptedOfferIdentifier,
      },
    });
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
  });

  it('resolves ICA jurisdiction from the trusted ICA did:web instead of the host route jurisdiction', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => buildIcaVerifyResponse(),
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      {
        ...buildConfig(),
        host: {
          jurisdiction: 'EU',
        },
        ica: {
          mode: 'external',
          externalUrl: EXAMPLE_ICA_BASE_URL,
          didWeb: 'did:web:34.175.75.120:ica:cds-ES:v1',
        },
      },
      mockHostRuntime,
    );

    await manager.process(buildTransactionJob(), 'test', false);

    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
  });

  it('returns OperationOutcome 400 when demo GW cannot resolve the trusted ICA jurisdiction', async () => {
    global.fetch = jest.fn() as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      {
        ...buildConfig(),
        host: {
          jurisdiction: 'EU',
        },
        ica: {
          mode: 'external',
          externalUrl: EXAMPLE_ICA_BASE_URL,
        },
      },
      mockHostRuntime,
    );

    const response = await manager.process(buildTransactionJob(), 'test', false);
    const errorEntry = response.body.data[0];

    expect(global.fetch).not.toHaveBeenCalled();
    expect(errorEntry?.response?.status).toBe('400');
    expect(errorEntry?.response?.outcome?.issue?.[0]?.diagnostics).toContain('ICA jurisdiction could not be resolved');
  });
});
