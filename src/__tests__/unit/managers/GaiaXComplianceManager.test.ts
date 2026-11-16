// Flow contract: authenticate a registered client under an active tenant and retain the server-resolved vault when its public DID has no hosted routing path; public DID text never selects another tenant's signing keys.
import { GaiaXComplianceManager } from '../../../managers/GaiaXComplianceManager';
import { EXAMPLE_PROVIDER_ORGANIZATION_DID, EXAMPLE_TENANT_ROUTE_CONTEXT } from 'gdc-common-utils-ts/examples/shared';
import { getTenantVaultId } from '../../../utils/tenant';

describe('tenant GXDCH client binding', () => {
  const input = { ...EXAMPLE_TENANT_ROUTE_CONTEXT, vpToken: 'tenant.signed.presentation', clientAssertion: 'registered.client.assertion',
    clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', requestUrl: 'https://gateway.example/standard-compliance' };
  function fixture(active = true) {
    const clients = { verifyRegisteredClientAssertion: jest.fn().mockResolvedValue('registered-client') };
    const compliance = { verifyPresentation: jest.fn().mockResolvedValue({ credentialJwt: 'original.signed.credential' }) };
    const manager = new GaiaXComplianceManager({ tenantExists: async () => true, isTenantOperational: async () => active,
      getDidDocument: async () => ({ id: EXAMPLE_PROVIDER_ORGANIZATION_DID }) } as any, clients, compliance as any);
    return { manager, clients, compliance };
  }
  it('passes the authenticated server-resolved vault alongside the public tenant DID', async () => {
    const f = fixture(); await f.manager.verify(input);
    expect(f.compliance.verifyPresentation).toHaveBeenCalledWith({ tenantDid: EXAMPLE_PROVIDER_ORGANIZATION_DID,
      tenantVaultId: getTenantVaultId(input.sector, input.tenantId), vpToken: input.vpToken });
  });
  it('rejects a suspended tenant before invoking the provider', async () => {
    const f = fixture(false); await expect(f.manager.verify(input)).rejects.toThrow();
    expect(f.clients.verifyRegisteredClientAssertion).not.toHaveBeenCalled(); expect(f.compliance.verifyPresentation).not.toHaveBeenCalled();
  });
});
