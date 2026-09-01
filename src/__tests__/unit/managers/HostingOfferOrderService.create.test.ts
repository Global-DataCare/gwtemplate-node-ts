// Flow contract: an active tenant controller requests only professional-seat quantity; GW authors policy-controlled Offer terms, persists the protected Offer under host custody, and returns a usable Offer for Order confirmation.
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HostingOfferOrderService } from '../../../managers/hosting/HostingOfferOrderService';

describe('HostingOfferOrderService professional-seat Offer creation', () => {
  it('persists a host-authored Offer for an active tenant', async () => {
    const vaultRepository = { put: jest.fn(async () => undefined) } as any;
    const kmsService = {
      protectConfidentialData: jest.fn(async (document) => ({ ...document, jwe: { ciphertext: 'protected' } })),
    } as any;
    const tenantsCacheManager = { isTenantOperational: jest.fn(async () => true) } as any;
    const service = new HostingOfferOrderService(
      vaultRepository,
      kmsService,
      tenantsCacheManager,
      {
        apiBaseUrl: 'https://gw.example.test',
        hostExternalDomain: 'gw.example.test',
        host: { jurisdiction: 'CA-BC' },
        allowedPaymentMethods: ['TestNetworkVirtual'],
      } as any,
      { hostCollectionName: 'host-collection' } as any,
    );

    const response = await service.processEmployeeLicenseOfferCreateEntry(
      { tenantId: '7654321', sector: 'animal-care' } as any,
      {
        type: 'License:Purchase',
        meta: { claims: {
          '@context': 'org.schema',
          '@type': 'License:Purchase',
          'org.schema.IndividualProduct.category': 'professional',
          'org.schema.Offer.eligibleQuantity.value': 3,
        } },
      } as any,
    );

    expect(response.response?.status).toBe('201');
    expect(response.meta?.claims).toEqual(expect.objectContaining({
      [ClaimsOrganizationSchemaorg.alternateName]: '7654321',
      [ClaimsOfferSchemaorg.eligibleQuantityValue]: 3,
      [ClaimsOfferSchemaorg.acceptedPaymentMethod]: 'TestNetworkVirtual',
    }));
    expect(vaultRepository.put).toHaveBeenCalled();
  });
});
