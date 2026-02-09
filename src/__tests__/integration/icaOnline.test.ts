import { IcaManager } from '../../managers/IcaManager';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';

const makeJob = (): JobRequest => ({
  id: 'job-ica-online',
  tenantId: 'host',
  jurisdiction: 'es',
  sector: 'system',
  section: 'test-network',
  format: 'ica',
  resourceType: 'Enroll',
  action: '_create',
  sequence: 0,
  status: 'DRAFT' as any,
  createdAtTimestamp: Date.now(),
  content: {
    aud: 'did:web:host',
    iss: 'did:web:test-eur-ica.unid.online',
    jti: 'jti-ica-online',
    thid: 'thid-ica-online',
    type: 'ica-enroll-request',
    body: {
      csr: '---CSR---',
    },
    meta: {},
  },
});

describe('ICA online integration', () => {
  const isEnabled = String(process.env.ICA_ONLINE_TESTS || '').toLowerCase() === 'true';
  const run = isEnabled ? it : it.skip;

  run(
    'should reach the ICA Fabric-CA endpoint (fails if offline)',
    async () => {
      process.env.ICA_AUTO_APPROVE = 'true';
      if (!process.env.ICA_FABRIC_CA_ENROLL_URL) {
        throw new Error('ICA_FABRIC_CA_ENROLL_URL must be set for ICA_ONLINE_TESTS=true');
      }

      const manager = new IcaManager();
      const response = await manager.process(makeJob());
      const entry = (response.body as any).data?.[0];
      expect(entry?.meta?.claims?.status).toBe('approved');
    },
    30000,
  );
});
