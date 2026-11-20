// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Flow contract: require authenticated current trust evidence in non-demo profiles; preserve the separately selected local demo contract.
import { DefaultTrustRegistryAdapter } from '../../../adapters/trust-registry.adapter';

describe('DefaultTrustRegistryAdapter', () => {
  const originalSecurityMode = process.env.SECURITY_MODE;
  beforeEach(() => { process.env.SECURITY_MODE = 'strict'; });
  afterEach(() => {
    if (originalSecurityMode === undefined) delete process.env.SECURITY_MODE;
    else process.env.SECURITY_MODE = originalSecurityMode;
  });
  it.each(['test', 'local-network', 'test-network', 'network'] as const)('rejects absent evidence in %s', async networkMode => {
    await expect(new DefaultTrustRegistryAdapter().verifyActivationTrust({ networkMode, organizationDid: 'did:web:org.example' })).rejects.toThrow(/evidence/);
  });
  it('rejects off-chain evidence without native ICA activation authority', async () => {
    const verificationEvidence = { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false };
    await expect(new DefaultTrustRegistryAdapter().verifyActivationTrust({ networkMode: 'network', organizationDid: 'did:web:org.example', verificationEvidence })).rejects.toThrow(/evidence/);
  });
  it.each(['revocationChecked', 'issuerKeyStatusChecked', 'subjectKeyStatusChecked'] as const)('requires %s even for native ICA activation', async check => {
    const verificationEvidence = { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false, [check]: false };
    await expect(new DefaultTrustRegistryAdapter().verifyActivationTrust({ networkMode: 'network', organizationDid: 'did:web:org.example', activationEvidenceSource: 'ica', verificationEvidence })).rejects.toThrow(/evidence/);
  });
  it('preserves explicit positive checks supplied by the authenticated verifier', async () => {
    const evidence = { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: true };
    expect(await new DefaultTrustRegistryAdapter().verifyActivationTrust({ networkMode: 'test-network', organizationDid: 'did:web:org.example', verificationEvidence: evidence })).toEqual(evidence);
  });
});
