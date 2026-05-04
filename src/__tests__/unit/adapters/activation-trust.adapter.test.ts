import { describe, expect, it, jest } from '@jest/globals';
import { DefaultActivationTrustAdapter } from '../../../adapters/activation-trust.adapter';
import { IClearingHouseService } from '../../../services/ClearingHouseService';
import { ITrustRegistryAdapter } from '../../../adapters/trust-registry.adapter';

function buildCredential(subjectDid: string): any {
  return {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    type: ['VerifiableCredential'],
    credentialSubject: { id: subjectDid },
  };
}

describe('DefaultActivationTrustAdapter', () => {
  it('marks strict trust checks in test-network/network and delegates VP verification', async () => {
    const clearingHouseService: IClearingHouseService = {
      verifyVpToken: jest.fn(async () => ({
        acr: 'urn:test:acr',
        ledgerVerified: true,
      })),
    };
    const trustRegistryAdapter: ITrustRegistryAdapter = {
      verifyActivationTrust: jest.fn(async () => ({
        revocationChecked: true,
        issuerKeyStatusChecked: true,
        subjectKeyStatusChecked: true,
        onChainChecked: false,
      })),
    };
    const adapter = new DefaultActivationTrustAdapter(clearingHouseService, trustRegistryAdapter);

    const result = await adapter.evaluate({
      networkMode: 'test-network',
      vpToken: 'vp-token-001',
      organizationCredential: buildCredential('did:web:org.example'),
      representativeCredential: buildCredential('did:web:rep.example'),
    });

    expect(result.organizationDid).toBe('did:web:org.example');
    expect(result.clearingHouse.acr).toBe('urn:test:acr');
    expect(result.trustPolicy.networkMode).toBe('test-network');
    expect(result.trustPolicy.revocationChecked).toBe(true);
    expect(result.trustPolicy.onChainChecked).toBe(false);
    expect((trustRegistryAdapter.verifyActivationTrust as jest.Mock).mock.calls[0][0]).toMatchObject({
      networkMode: 'test-network',
      organizationDid: 'did:web:org.example',
    });
  });

  it('allows activation without representative credential', async () => {
    const clearingHouseService: IClearingHouseService = {
      verifyVpToken: jest.fn(async () => ({
        acr: 'urn:test:acr',
        ledgerVerified: true,
      })),
    };
    const trustRegistryAdapter: ITrustRegistryAdapter = {
      verifyActivationTrust: jest.fn(async () => ({
        revocationChecked: true,
        issuerKeyStatusChecked: true,
        subjectKeyStatusChecked: true,
        onChainChecked: true,
      })),
    };
    const adapter = new DefaultActivationTrustAdapter(clearingHouseService, trustRegistryAdapter);

    const result = await adapter.evaluate({
      networkMode: 'network',
      vpToken: 'vp-token-001',
      organizationCredential: buildCredential('did:web:org.example'),
    });

    expect(result.organizationDid).toBe('did:web:org.example');
    expect(result.representativeDid).toBeUndefined();
  });
});
