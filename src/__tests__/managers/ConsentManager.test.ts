// TDD contract: write this test red first; make it green only with the complete real behavior.
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { createHash, randomUUID } from 'crypto';
import { mock, MockProxy } from 'jest-mock-extended';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ConsentManager } from '../../managers/ConsentManager';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { BundleJsonApi, BundleEntryRequest, BundleEntryMeta, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { OperationOutcome } from 'gdc-common-utils-ts/models/operation-outcome';
import { ConsentRule, ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { CONSENT_CREATION_MESSAGE } from '../data/example-payloads';
import { buildConsentRuleStorageKey, hashConsentRuleId } from '../../utils/consent';
import { getClaimValue } from '../../utils/claims';
import { knownDomainsReversed, knownDomainsReversedEnum } from 'gdc-common-utils-ts/models/urlPath';
import { getTenantVaultId } from '../../utils/tenant';
import { getIndividualSectionId } from '../../utils/individual-sections';
import type { IBlockchainAdapter } from '../../adapters/IBlockchainAdapter';
import {
  buildConsentRulePrimaryDocument,
  deriveConsentRuleBlockchainStatus,
} from '../../utils/consent-access-blockchain';
import { getJurisdictionGroup } from '../../utils/jurisdiction';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';

/**
 * @fileoverview This test suite verifies the functionality of the ConsentManager.
 *
 * @architecture
 * **Mocking Strategy: `jest-mock-extended`**
 *
 * This test suite uses the `jest-mock-extended` library to create type-safe mocks
 * of external dependencies, such as the `IVaultRepository`.
 *
 * **Why this pattern is used:**
 * 1.  **True Unit Testing:** By using `mock<IVaultRepository>()`, we test the `ConsentManager`'s
 *     interaction with the repository *interface* (the contract), not a specific
 *     implementation like `VaultMemRepository`. This isolates the manager's logic.
 * 2.  **Type Safety:** The mock is fully type-safe. If the `IVaultRepository` interface
 *     changes (e.g., a method is added or renamed), TypeScript will raise a
 *     compilation error in this test file, preventing stale tests.
 * 3.  **Avoids Brittle Tests:** The test is not dependent on the internal workings
 *     of `VaultMemRepository`. This means changes to the in-memory repository
 *     won't break the `ConsentManager`'s unit tests, as long as the manager
 *     still respects the `IVaultRepository` contract.
 */
describe('ConsentManager', () => {
  let consentManager: ConsentManager;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockBlockchainAdapter: MockProxy<IBlockchainAdapter>;

  // --- Test Data Setup ---
  const mockTenantId = 'test-tenant';
  const mockSubjectId = 'unified-health-id';
  const mockJurisdiction = 'ES';
  const mockSector = 'test-sector';
  const mockIdentifier = CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims['Consent.identifier'];
  const mockActorIdentifier = CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims['Consent.actor-identifier'];
  const mockAttachmentData = CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims['Consent.attachment-data'];
  const mockAttachmentHash = createHash('sha3-384')
    .update(Buffer.from(mockAttachmentData, 'base64'))
    .digest('hex');
  const mockAttachmentDataBase64 = mockAttachmentData;

  const mockClaims: ConsentRule = {
    ...CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims,
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.decision]: 'permit',
    [ClaimConsent.subject]: mockSubjectId,
  };

  const mockMeta: BundleEntryMeta = { claims: mockClaims };
  const mockEntry: BundleEntryRequest = {
    type: ResourceTypesFhirR4.Consent,
    meta: mockMeta,
    resource: { resourceType: ResourceTypesFhirR4.Consent },
    request: { method: HttpRequestMethods.Post, url: `/${mockSector}/individual/org.hl7.fhir.api/Consent`},
  };
  const mockBundleJsonApi: BundleJsonApi<BundleEntryRequest> = {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'batch',
    data: [mockEntry],
  };
  const mockDecodedMessage: IDecodedDidcommPayload = {
      jti: randomUUID(),
      type: 'org.hl7.fhir.r4.Bundle',
      thid: randomUUID(),
      iss: 'did:web:app.example.com',
      aud: `did:web:gateway.example.com#v1_${mockSector}_individual_org.hl7.fhir.api_Consent__batch`,
      body: mockBundleJsonApi,
  };
  const mockJobRequest: JobRequest = {
      content: mockDecodedMessage,
      tenantId: mockTenantId,
      jurisdiction: mockJurisdiction,
      sector: mockSector,
      section: 'individual',
      format: knownDomainsReversedEnum['org.hl7.fhir.api'],
      resourceType: ResourceTypesFhirR4.Consent,
      action: '_batch',
      id: randomUUID(),
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
  };

  beforeEach(() => {
    // Create a type-safe mock of the repository
    mockVaultRepository = mock<IVaultRepository>();
    mockBlockchainAdapter = mock<IBlockchainAdapter>();
    mockVaultRepository.getAllSections.mockResolvedValue([]);
    mockVaultRepository.listContainersInSection.mockResolvedValue([]);
    mockVaultRepository.get.mockResolvedValue(undefined);
    mockVaultRepository.delete.mockResolvedValue(true);
    // Inject the mock into the manager
    consentManager = new ConsentManager({vaultRepository: mockVaultRepository, blockchainAdapter: mockBlockchainAdapter});
  });

  it('disables the subject digital-twin projection when research use is withdrawn', async () => {
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    const request = structuredClone(mockJobRequest);
    const claims = (request.content!.body as any).data[0].meta.claims;
    claims[ClaimConsent.decision] = 'deny';
    claims[ClaimConsent.purpose] = 'RESEARCH';
    claims[ClaimConsent.action] = ServiceCapability.DigitalTwinReader;
    claims[ClaimConsent.sourceReference] = 'https://portal.example/research';
    delete claims[ClaimConsent.identifier];

    const response = await consentManager.process(request);

    expect((response.body as any).data[0].response.status).toBe('201');
    expect(mockVaultRepository.put).toHaveBeenCalledWith(
      getTenantVaultId(mockSector, mockTenantId),
      [expect.objectContaining({
        type: 'digital-twin-secondary-use-status',
        status: 'disabled',
      })],
      expect.stringContaining('digitaltwin_secondary_use_status'),
    );
  });

  it('accepts digital-twin secondary-use FHIR Consent claims without an ODRL attachment', async () => {
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    const request = structuredClone(mockJobRequest);
    const claims = (request.content!.body as any).data[0].meta.claims;
    claims[ClaimConsent.purpose] = HealthcareConsentPurposes.Research;
    claims[ClaimConsent.action] = ServiceCapability.DigitalTwinReader;
    claims[ClaimConsent.sourceReference] = 'https://portal.example/research';
    delete claims[ClaimConsent.identifier];
    delete claims[ClaimConsent.attachmentContentType];
    delete claims[ClaimConsent.attachmentData];

    const response = await consentManager.process(request);

    expect((response.body as any).data[0].response.status).toBe('201');
    const attachmentWrites = mockVaultRepository.put.mock.calls
      .filter((call) => String(call[2]).includes('attachments'));
    expect(attachmentWrites).toHaveLength(0);
    const storedRule = mockVaultRepository.put.mock.calls
      .find((call) => String(call[2]).includes('rules'))?.[1][0] as Record<string, any>;
    expect(getClaimValue(storedRule, ClaimConsent.attachmentContentType)).toBeUndefined();
    expect(getClaimValue(storedRule, ClaimConsent.attachmentData)).toBeUndefined();
    expect(getClaimValue(storedRule, ClaimConsent.attachmentId)).toBeUndefined();
    expect(getClaimValue(storedRule, ClaimConsent.identifier)).toMatch(/^urn:uuid:/);
  });

  it('upserts by application/study source reference while keeping the internal identifier out of the caller contract', async () => {
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    const registerConsentAccessBundle = mockBlockchainAdapter.registerConsentAccessBundle as jest.MockedFunction<
      NonNullable<IBlockchainAdapter['registerConsentAccessBundle']>
    >;
    registerConsentAccessBundle.mockResolvedValue({ accepted: 1, txId: 'tx-consent-id-isolation' });
    const buildRequest = (sourceReference: string, decision: 'permit' | 'deny') => {
      const request = structuredClone(mockJobRequest);
      const claims = (request.content!.body as any).data[0].meta.claims;
      claims[ClaimConsent.identifier] = `urn:uuid:caller-owned-${decision}-${sourceReference}`;
      claims[ClaimConsent.sourceReference] = sourceReference;
      claims[ClaimConsent.decision] = decision;
      claims[ClaimConsent.purpose] = HealthcareConsentPurposes.Research;
      claims[ClaimConsent.action] = ServiceCapability.DigitalTwinReader;
      return request;
    };

    await consentManager.process(buildRequest('https://portal.example/research', 'permit'));
    await consentManager.process(buildRequest('urn:study:future-trial-42', 'permit'));
    await consentManager.process(buildRequest('https://portal.example/research', 'deny'));

    const storedRules = mockVaultRepository.put.mock.calls
      .filter((call) => String(call[2]).includes('rules'))
      .map((call) => call[1][0] as Record<string, any>);
    expect(storedRules).toHaveLength(3);
    expect(storedRules[0].id).not.toBe(storedRules[1].id);
    expect(storedRules[2].id).toBe(storedRules[0].id);
    expect(getClaimValue(storedRules[2], ClaimConsent.identifier)).toBe(
      getClaimValue(storedRules[0], ClaimConsent.identifier),
    );
    expect(getClaimValue(storedRules[0], ClaimConsent.identifier)).not.toContain('caller-owned');
    const ledgerAssetIds = registerConsentAccessBundle.mock.calls
      .map((call) => call[0].assetId);
    expect(ledgerAssetIds[0]).not.toBe(ledgerAssetIds[1]);
  });

  it('should save attachment and rule to the correct sections in the vault', async () => {
    // Arrange: Define the behavior of the mocked repository for this specific test
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);

    // Act
    const jobResponse = await consentManager.process(mockJobRequest);

    // Assert: Verify the response and interactions with the mock
    const responseBody = jobResponse.body as BundleJsonApi;
    const responseEntry = responseBody.data[0] as BundleEntryResponse;
    expect(responseEntry.response.status).toEqual('201');
    expect(responseBody.type).toEqual('_batch-response');
    expect(responseEntry.response.location).toEqual(
      `/test-tenant/cds-${mockJurisdiction}/v1/test-sector/individual/org.hl7.fhir.api/Consent/_batch-response`
    );
    expect(responseEntry.response.location).not.toMatch(/\/Consent\/[0-9a-f]{8,}/i);

    const tenantVaultId = getTenantVaultId(mockSector, mockTenantId);
    expect(mockVaultRepository.vaultExists).toHaveBeenCalledWith(tenantVaultId);
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(3);

    // Assert the attachment was stored correctly
    const [attachmentVaultId, attachmentDocs, attachmentSection] = mockVaultRepository.put.mock.calls[0];
    const storedAttachment = attachmentDocs[0];
    expect(attachmentVaultId).toEqual(tenantVaultId);
    expect(attachmentSection).toEqual(getIndividualSectionId(mockSubjectId, 'attachments'));
    expect(storedAttachment.id).toEqual(mockAttachmentHash);
    expect((storedAttachment as any).data).toEqual(mockAttachmentDataBase64);

    // Assert the rule was stored correctly
    const [ruleVaultId, ruleDocs, ruleSection] = mockVaultRepository.put.mock.calls[1];
    const storedRule = ruleDocs[0] as Record<string, any>;
    const expectedRuleKey = buildConsentRuleStorageKey({
      subjectId: mockSubjectId,
      sector: mockSector,
      target: mockActorIdentifier,
      decision: 'permit',
      purpose: mockClaims[ClaimConsent.purpose] as string,
    });
    const expectedRuleId = hashConsentRuleId(expectedRuleKey);
    expect(ruleVaultId).toEqual(tenantVaultId);
    expect(ruleSection).toEqual(getIndividualSectionId(mockSubjectId, 'rules'));
    expect(storedRule.id).toEqual(expectedRuleId);
    const [subjectRuleVaultId, subjectRuleDocs, subjectRuleSection] = mockVaultRepository.put.mock.calls[2];
    expect(subjectRuleVaultId).toEqual(tenantVaultId);
    expect(subjectRuleDocs[0]).toEqual(storedRule);
    expect(subjectRuleSection).toContain('individual_consents_');
    expect(getClaimValue(storedRule, ClaimConsent.attachmentId)).toEqual(mockAttachmentHash);
    expect(getClaimValue(storedRule, ClaimConsent.attachmentData)).toBeUndefined();
  });

  it('should project one accepted consent rule to one blockchain write when the adapter supports it', async () => {
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    mockBlockchainAdapter.registerConsentAccessBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx-consentaccess-1' });

    await consentManager.process(mockJobRequest);

    expect(mockBlockchainAdapter.registerConsentAccessBundle).toHaveBeenCalledTimes(1);
    const consentAccessCall = (mockBlockchainAdapter.registerConsentAccessBundle as jest.Mock).mock.calls[0][0];
    const expectedPayload = buildConsentRulePrimaryDocument([
      {
        ...mockEntry,
        resource: {
          ...mockEntry.resource,
          meta: {
            claims: mockClaims,
          },
        },
      },
    ]);
    expect(consentAccessCall.channel).toEqual(`${mockSector}-${getJurisdictionGroup(mockJurisdiction)}`);
    expect(consentAccessCall.chaincode).toEqual('consentaccess-sc');
    expect(consentAccessCall.assetId).toEqual(consentAccessCall.payload.data[0].id);
    expect(consentAccessCall.payload).toEqual({
      status: deriveConsentRuleBlockchainStatus(mockClaims as unknown as Record<string, unknown>),
      data: [consentAccessCall.payload.data[0]],
    });
  });

  it('ignores deployment overrides and resolves the governed consent route internally', async () => {
    const previousConsentChannel = process.env.CONSENT_ACCESS_LEDGER_CHANNEL;
    const previousDataChannel = process.env.HLF_DATA_CHANNEL_NAME;
    const previousChaincode = process.env.CONSENT_ACCESS_LEDGER_CHAINCODE;
    const previousNetworkMode = process.env.NETWORK_MODE;
    process.env.CONSENT_ACCESS_LEDGER_CHANNEL = 'must-not-control-manager-routing';
    process.env.HLF_DATA_CHANNEL_NAME = 'must-not-control-manager-routing';
    process.env.CONSENT_ACCESS_LEDGER_CHAINCODE = 'must-not-control-manager-routing';
    process.env.NETWORK_MODE = 'test';
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    mockBlockchainAdapter.registerConsentAccessBundle = jest.fn().mockResolvedValue({ accepted: 1 });

    try {
      await consentManager.process(mockJobRequest);
      expect(mockBlockchainAdapter.registerConsentAccessBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: `${mockSector}-${getJurisdictionGroup(mockJurisdiction)}`,
          chaincode: 'consentaccess-sc',
        }),
      );
    } finally {
      if (previousConsentChannel === undefined) delete process.env.CONSENT_ACCESS_LEDGER_CHANNEL;
      else process.env.CONSENT_ACCESS_LEDGER_CHANNEL = previousConsentChannel;
      if (previousDataChannel === undefined) delete process.env.HLF_DATA_CHANNEL_NAME;
      else process.env.HLF_DATA_CHANNEL_NAME = previousDataChannel;
      if (previousChaincode === undefined) delete process.env.CONSENT_ACCESS_LEDGER_CHAINCODE;
      else process.env.CONSENT_ACCESS_LEDGER_CHAINCODE = previousChaincode;
      if (previousNetworkMode === undefined) delete process.env.NETWORK_MODE;
      else process.env.NETWORK_MODE = previousNetworkMode;
    }
  });

  it('should perform one blockchain write per derived atomic rule', async () => {
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    mockBlockchainAdapter.registerConsentAccessBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx-consentaccess-1' });

    const multiRuleClaims: ConsentRule = {
      ...mockClaims,
      [ClaimConsent.actorIdentifier]: 'mailto:doctor@acme-id.org,mailto:nurse@acme-id.org',
      [ClaimConsent.purpose]: 'treatment,research',
    };

    const multiRuleEntry: BundleEntryRequest = {
      ...mockEntry,
      meta: { claims: multiRuleClaims },
      resource: {
        ...mockEntry.resource,
        meta: {
          claims: multiRuleClaims,
        },
      },
    };
    const multiRuleJob: JobRequest = {
      ...mockJobRequest,
      content: {
        ...mockDecodedMessage,
        body: {
          ...mockBundleJsonApi,
          data: [multiRuleEntry],
        },
      },
    };

    await consentManager.process(multiRuleJob);

    const expectedPayload = buildConsentRulePrimaryDocument([multiRuleEntry]);
    expect(mockBlockchainAdapter.registerConsentAccessBundle).toHaveBeenCalledTimes(expectedPayload.data.length);

    const writeCalls = (mockBlockchainAdapter.registerConsentAccessBundle as jest.Mock).mock.calls.map((call) => call[0]);
    expect(writeCalls.map((call) => call.assetId)).toEqual(writeCalls.map((call) => call.payload.data[0].id));
    expect(writeCalls.map((call) => call.payload.status)).toEqual(
      expectedPayload.data.map(() => deriveConsentRuleBlockchainStatus(multiRuleClaims as unknown as Record<string, unknown>)),
    );
  });

  it('should revoke and later reactivate the same blockchain rule id when Consent.period-end changes', async () => {
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    mockVaultRepository.put.mockResolvedValue(true);
    mockBlockchainAdapter.registerConsentAccessBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx-consentaccess-lifecycle' });

    const activeClaims: ConsentRule = {
      ...mockClaims,
      [ClaimConsent.actorIdentifier]: 'mailto:doctor.oncall@example.org',
      [ClaimConsent.actorRole]: 'ISCO-08|2211',
      [ClaimConsent.purpose]: 'ETREAT',
      [ClaimConsent.action]: 'LOINC|60591-5',
    };
    const revokedClaims: ConsentRule = {
      ...activeClaims,
      [ClaimConsent.periodEnd]: '2026-06-01T00:00:00Z',
    };

    const activeEntry: BundleEntryRequest = {
      ...mockEntry,
      meta: { claims: activeClaims },
      resource: { ...mockEntry.resource, meta: { claims: activeClaims } },
    };
    const revokedEntry: BundleEntryRequest = {
      ...mockEntry,
      meta: { claims: revokedClaims },
      resource: { ...mockEntry.resource, meta: { claims: revokedClaims } },
    };

    const activeJob: JobRequest = {
      ...mockJobRequest,
      content: { ...mockDecodedMessage, body: { ...mockBundleJsonApi, data: [activeEntry] } },
    };
    const revokedJob: JobRequest = {
      ...mockJobRequest,
      content: { ...mockDecodedMessage, body: { ...mockBundleJsonApi, data: [revokedEntry] } },
    };

    await consentManager.process(activeJob);
    await consentManager.process(revokedJob);
    await consentManager.process(activeJob);

    const lifecycleCalls = (mockBlockchainAdapter.registerConsentAccessBundle as jest.Mock).mock.calls.map((call) => call[0]);

    expect(lifecycleCalls).toHaveLength(3);
    expect(new Set(lifecycleCalls.map((call) => call.assetId)).size).toBe(1);
    expect(lifecycleCalls.map((call) => call.payload.status)).toEqual(['active', 'revoked', 'active']);
  });

  it('should return a 400 error if a required claim is missing', async () => {
    // Arrange
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    const invalidJob = JSON.parse(JSON.stringify(mockJobRequest));
    delete invalidJob.content.body.data[0].meta.claims[ClaimConsent.decision];

    // Act
    const jobResponse = await consentManager.process(invalidJob);

    // Assert
    const responseEntry = (jobResponse.body as BundleJsonApi).data[0] as ErrorEntry;
    expect(responseEntry.response.status).toEqual('400');
    const outcome = responseEntry.response.outcome as OperationOutcome;
    expect(outcome.issue[0].diagnostics).toContain(`Missing required claim: ${ClaimConsent.decision}`);
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('should return a 404 error if the individual vault does not exist', async () => {
    // Arrange
    mockVaultRepository.vaultExists.mockResolvedValue(false);

    // Act
    const jobResponse = await consentManager.process(mockJobRequest);

    // Assert
    const responseEntry = (jobResponse.body as BundleJsonApi).data[0] as ErrorEntry;
    expect(responseEntry.response.status).toEqual('404');
    const outcome = responseEntry.response.outcome as OperationOutcome;
    expect(outcome.issue[0].diagnostics).toContain(`Tenant vault not found: ${getTenantVaultId(mockSector, mockTenantId)}`);
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });
});
