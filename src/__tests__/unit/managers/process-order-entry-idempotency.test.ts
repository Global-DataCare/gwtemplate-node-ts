/** Host Order replay remains recoverable across mandatory ledger failures. */
import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { processHostOrderEntry } from '../../../managers/hosting/process-order-entry';

describe('processHostOrderEntry active offer idempotency', () => {
  it('keeps the pending Offer authoritative when mandatory ledger registration fails', async () => {
    const offerId = 'urn:cds:ES:v1:health-care:product:org.schema:Offer:pending';
    const pendingClaims = {
      [ClaimsOfferSchemaorg.identifier]: offerId,
      [ClaimsOrganizationSchemaorg.alternateName]: 'example-tenant',
      [ClaimsOrganizationSchemaorg.addressCountry]: 'US',
      [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
      [ClaimsOrganizationSchemaorg.identifierValue]: 'example-tenant',
      [ClaimsOrganizationSchemaorg.legalName]: 'Example Organization',
      [ClaimsServiceSchemaorg.category]: 'health-care',
    };
    const put = jest.fn(async () => true);
    const ledgerFailure = new Error('ledger endorsement timeout');

    await expect(processHostOrderEntry({
      entry: { meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } } } as any,
      vaultRepository: {
        query: jest.fn(async () => [{
          id: 'health-care_example-tenant',
          status: 'pending',
          content: { status: 'pending', claims: pendingClaims, contained: [] },
        }]),
        createNewVault: jest.fn(async () => true),
        put,
      } as any,
      kmsService: {
        unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
        provisionKeys: jest.fn(async () => undefined),
        protectConfidentialData: jest.fn(async (doc: any) => doc),
      } as any,
      logger: { error: jest.fn() } as any,
      config: {
        namespace: 'gdc', networkMode: 'test-network',
        apiBaseUrl: 'https://host.example.org', hostExternalDomain: 'host.example.org',
        host: { jurisdiction: 'ES' }, ledger: {},
      } as any,
      hostRuntime: { hostCollectionName: 'system_host' } as any,
      offerOrderService: { processLicenseOrderEntry: jest.fn() } as any,
      extractResources: jest.fn(() => ({
        organization: { id: 'urn:org:tax:example-tenant' },
        service: { id: 'service-example' },
      })) as any,
      extractContainedService: jest.fn(() => undefined),
      finalizeTenantConfig: jest.fn(async () => ({
        status: 'active', claims: pendingClaims, governanceVc: {}, selfDescriptionVc: {},
        didDocument: { id: 'did:web:host.example.org:example-tenant:cds-US:v1:health-care' },
      })) as any,
      isLedgerRegistrationEnabled: jest.fn(() => true),
      extractServiceEvidence: jest.fn(() => undefined),
      buildControllerEntityConfig: jest.fn() as any,
      storeControllerEntityConfig: jest.fn() as any,
      getCurrentUrnNetwork: jest.fn(() => 'test-network'),
      registerOrganizationOnLedger: jest.fn(async () => { throw ledgerFailure; }),
    })).rejects.toBe(ledgerFailure);

    expect(put).not.toHaveBeenCalled();
  });

  it('does not issue licenses or require another payment when replaying an accepted organization offer', async () => {
    const offerId = 'urn:cds:ES:v1:health-care:product:org.schema:Offer:existing';
    const response = await processHostOrderEntry({
      entry: { meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } } } as any,
      vaultRepository: {
        query: jest.fn(async () => [{
          status: 'active',
          content: { status: 'active', claims: {
            [ClaimsOfferSchemaorg.identifier]: offerId,
            [ClaimsOrganizationSchemaorg.alternateName]: 'example-tenant',
            [ClaimsServiceSchemaorg.category]: 'health-care',
          } },
        }]),
        put: jest.fn(),
      } as any,
      kmsService: { unprotectConfidentialData: jest.fn(async (doc: any) => doc.content) } as any,
      logger: { error: jest.fn() } as any,
      config: {} as any,
      hostRuntime: { hostCollectionName: 'system_host' } as any,
      offerOrderService: { processLicenseOrderEntry: jest.fn() } as any,
      extractResources: jest.fn() as any,
      extractContainedService: jest.fn() as any,
      finalizeTenantConfig: jest.fn() as any,
      isLedgerRegistrationEnabled: jest.fn() as any,
      extractServiceEvidence: jest.fn() as any,
      buildControllerEntityConfig: jest.fn() as any,
      storeControllerEntityConfig: jest.fn() as any,
      getCurrentUrnNetwork: jest.fn() as any,
    });

    expect(response.response?.status).toBe('200');
    expect(response.meta?.claims?.[ClaimsOrderSchemaorg.acceptedOfferIdentifier]).toBe(offerId);
  });
});
