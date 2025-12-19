import { createHash, randomUUID } from 'crypto';
import { mock, MockProxy } from 'jest-mock-extended';
import { JobRequest, JobStatus } from '../../models/confidential-job';
import { IDecodedDidcommPayload } from '../../models/confidential-message';
import { ConsentManager } from '../../managers/ConsentManager';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { BundleJsonApi, BundleEntryRequest, BundleEntryMeta, BundleEntryResponse, ErrorEntry } from '../../models/bundle';
import { OperationOutcome } from '../../models/fhir/operation-outcome';
import { ConsentRule, ClaimConsent } from '../../models/consent-rule';
import { CONSENT_CREATION_MESSAGE } from '../data/example-payloads';
import { buildConsentRuleKey, hashConsentRuleId } from '../../utils/consent';
import { getClaimValue } from '../../utils/claims';

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

  // --- Test Data Setup ---
  const mockTenantId = 'test-tenant';
  const mockSubjectId = 'unified-health-id';
  const mockJurisdiction = 'au-nsw';
  const mockSector = 'test-sector';
  const mockIdentifier = CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims['Consent.identifier'];
  const mockGrantee = 'did:web:hospital.example.com';
  const mockAttachmentData = CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims['Consent.attachment-data'];
  const mockAttachmentDecoded = Buffer.from(mockAttachmentData, 'base64').toString('utf-8');
  const mockAttachmentHash = createHash('sha3-384').update(mockAttachmentDecoded).digest('hex');
  const mockAttachmentDataBase64 = mockAttachmentData;

  const mockClaims: ConsentRule = {
    ...CONSENT_CREATION_MESSAGE.body.entry[0].meta.claims,
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.decision]: 'permit',
    [ClaimConsent.subject]: mockSubjectId,
  };

  const mockMeta: BundleEntryMeta = { claims: mockClaims };
  const mockEntry: BundleEntryRequest = {
    type: 'Consent',
    resource: { resourceType: 'Consent', meta: mockMeta },
    request: { method: 'POST', url: `/${mockSector}/individual/org.hl7.fhir.api/Consent`},
  };
  const mockBundleJsonApi: BundleJsonApi<BundleEntryRequest> = {
    resourceType: 'Bundle',
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
      format: 'org.hl7.fhir.api',
      id: randomUUID(),
      status: JobStatus.DRAFT,
      sequence: 0,
      createdAtTimestamp: Date.now(),
  };

  beforeEach(() => {
    // Create a type-safe mock of the repository
    mockVaultRepository = mock<IVaultRepository>();
    // Inject the mock into the manager
    consentManager = new ConsentManager({vaultRepository: mockVaultRepository});
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

    const individualVaultId = `${mockTenantId}/${mockJurisdiction}/${mockSector}/individual/${mockSubjectId}`;
    expect(mockVaultRepository.vaultExists).toHaveBeenCalledWith(individualVaultId);
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(2);

    // Assert the attachment was stored correctly
    const [attachmentVaultId, attachmentDocs, attachmentSection] = mockVaultRepository.put.mock.calls[0];
    const storedAttachment = attachmentDocs[0];
    expect(attachmentVaultId).toEqual(individualVaultId);
    expect(attachmentSection).toEqual('attachments');
    expect(storedAttachment.id).toEqual(mockAttachmentHash);
    expect((storedAttachment as any).data).toEqual(mockAttachmentDataBase64);

    // Assert the rule was stored correctly
    const [ruleVaultId, ruleDocs, ruleSection] = mockVaultRepository.put.mock.calls[1];
    const storedRule = ruleDocs[0] as Record<string, any>;
    const expectedRuleKey = buildConsentRuleKey({
      subjectId: mockSubjectId,
      sector: mockSector,
      target: mockGrantee,
      decision: 'permit',
      purpose: mockClaims[ClaimConsent.purpose] as string,
    });
    const expectedRuleId = hashConsentRuleId(expectedRuleKey);
    expect(ruleVaultId).toEqual(individualVaultId);
    expect(ruleSection).toEqual('rules');
    expect(storedRule.id).toEqual(expectedRuleId);
    expect(getClaimValue(storedRule, ClaimConsent.attachmentId)).toEqual(mockAttachmentHash);
    expect(getClaimValue(storedRule, ClaimConsent.attachmentData)).toBeUndefined();
  });

  it('should return a 400 error if a required claim is missing', async () => {
    // Arrange
    mockVaultRepository.vaultExists.mockResolvedValue(true);
    const invalidJob = JSON.parse(JSON.stringify(mockJobRequest));
    delete invalidJob.content.body.data[0].resource.meta.claims[ClaimConsent.decision];

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
    expect(outcome.issue[0].diagnostics).toContain(`Individual vault not found for subject: ${mockSubjectId}`);
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });
});
