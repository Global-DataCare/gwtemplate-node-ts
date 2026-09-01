// Flow contract: a host-routed commercial Order resolves the controller's established DCR through the canonical tenant registry; repository adapters never substitute host custody for tenant custody.
import { resolveRegisteredSenderVaultIdForRoute } from '../../../routes/api';

describe('registered sender key custody', () => {
  it('resolves an official organization identifier to its canonical tenant vault', async () => {
    const resolved = await resolveRegisteredSenderVaultIdForRoute({
      tenantId: 'host',
      businessSectorOrNetworkKind: 'test-network',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Order',
      action: '_batch',
      senderDid: 'did:web:gw.example:887404386:cds-ca-bc:v1:animal-care',
      hostNetworkKind: 'test-network',
      tenantExists: async () => false,
      findTenantVaultIdByIdentifierValue: async (identifier: string) =>
        identifier === '887404386' ? 'animal-care_clinic-z' : undefined,
    });

    expect(resolved).toBe('animal-care_clinic-z');
  });

  it.each(['animal-care', 'test'])(
    'does not treat %s as the test-network host network kind',
    async (businessSectorOrNetworkKind) => {
      const resolved = await resolveRegisteredSenderVaultIdForRoute({
        tenantId: 'host',
        businessSectorOrNetworkKind,
        section: 'registry',
        format: 'org.schema',
        resourceType: 'Order',
        action: '_batch',
        senderDid: 'did:web:gw.example:887404386:cds-ca-bc:v1:animal-care',
        pathVaultId: 'host',
        hostNetworkKind: 'test-network',
        tenantExists: async () => true,
        findTenantVaultIdByIdentifierValue: async () => 'animal-care_clinic-z',
      });

      expect(resolved).toBe('host');
    },
  );
});
