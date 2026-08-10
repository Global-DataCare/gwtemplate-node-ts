import { SubscriptionManager } from '../../managers/SubscriptionManager';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { mockKmsService } from '../mocks/kms.mock';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId } from '../../utils/tenant';

describe('SubscriptionManager', () => {
  it('persists an encrypted tenant/BFF FHIR R5 rest-hook Subscription', async () => {
    const vaultRepository = new VaultMemRepository();
    const vaultId = getTenantVaultId('health-care', 'tenant.example');
    await vaultRepository.createNewVault({ id: vaultId });
    const manager = new SubscriptionManager({
      vaultRepository,
      kmsService: mockKmsService,
      tenantsCacheManager: { tenantExists: jest.fn(async () => true) } as any,
    });
    const result = await manager.process({
      tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'health-care',
      section: 'entity', format: 'org.hl7.fhir.r5', resourceType: 'Subscription', action: '_batch',
      content: { body: { resourceType: 'Bundle', type: 'batch', entry: [{ resource: {
        resourceType: 'Subscription', id: 'new-data', status: 'requested',
        topic: 'https://profiles.example/SubscriptionTopic/new-data',
        channelType: { code: 'rest-hook' }, endpoint: 'https://bff.example/fhir/subscriptions',
      } }] } },
    } as any);

    expect((result.body as any).data[0].response.status).toBe('201');
    const stored = await vaultRepository.get<any>(vaultId, 'new-data', getEnvSectionId('fhir-r5-subscriptions'));
    expect(stored?.jwe).toBeDefined();
  });

  it('rejects an individual Subscription without an exact subject filter', async () => {
    const manager = new SubscriptionManager({
      vaultRepository: new VaultMemRepository(), kmsService: mockKmsService,
      tenantsCacheManager: { tenantExists: jest.fn(async () => true) } as any,
    });
    const result = await manager.process({
      tenantId: 'tenant.example', jurisdiction: 'ES', sector: 'health-care',
      section: 'individual', format: 'org.hl7.fhir.r5', resourceType: 'Subscription', action: '_batch',
      content: { body: { entry: [{ resource: {
        resourceType: 'Subscription', id: 'too-broad', status: 'requested',
        topic: 'https://profiles.example/SubscriptionTopic/new-data',
        channelType: { code: 'rest-hook' }, endpoint: 'https://bff.example/events',
      } }] } },
    } as any);
    expect((result.body as any).data[0].response.status).toBe('400');
  });
});
