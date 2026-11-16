// Flow contract: a local-network label never turns a memory credential provider into Fabric evidence; the verifier must reject before resolving keys or contacting a ledger.
import { buildLocalClearingHouseVerifier } from '../../../bootstrap/build-clearing-house-verifier';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';

describe('Clearing House ledger composition', () => {
  it('keeps the actual memory provider distinct from a local-network label', async () => {
    const saved = { ...process.env };
    process.env.NETWORK_MODE = 'local-network'; process.env.HOST_JURISDICTION = 'ES';
    try {
      const verifier = buildLocalClearingHouseVerifier({ network: 'local-network', ledgerKind: 'memory', tenants: {} as any,
        ledger: new CredentialLedgerAdapterMem(), vaultRepository: {} as any, kmsService: {} as any, cryptography: {} as any,
        authorize: async () => { throw new Error('Not reached.'); } });
      await expect(verifier.verifyVpToken({ tenantDid: 'did:web:host.example:acme:cds-ES:v1:health-care',
        vpToken: 'e30.e30.signature', acrValues: [] })).rejects.toThrow(/authoritative Fabric ledger/i);
    } finally { process.env = saved; }
  });
});
