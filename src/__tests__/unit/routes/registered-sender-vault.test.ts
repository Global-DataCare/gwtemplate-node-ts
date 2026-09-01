// Flow contract: a host-routed commercial Order resolves the controller's established DCR through the canonical tenant registry; repository adapters never substitute host custody for tenant custody.
import { resolveRegisteredSenderVaultIdForRoute } from '../../../routes/api';

describe('registered sender key custody', () => {
  it('resolves an official organization identifier to its canonical tenant vault', async () => {
    const resolved = await resolveRegisteredSenderVaultIdForRoute({
      tenantId: 'host',
      sector: 'test-network',
      section: 'registry',
      format: 'org.schema',
      resourceType: 'Order',
      action: '_batch',
      senderDid: 'did:web:gw.example:887404386:cds-ca-bc:v1:animal-care',
      tenantExists: async () => false,
      findTenantVaultIdByIdentifierValue: async (identifier: string) =>
        identifier === '887404386' ? 'animal-care_clinic-z' : undefined,
    });

    expect(resolved).toBe('animal-care_clinic-z');
  });
});
