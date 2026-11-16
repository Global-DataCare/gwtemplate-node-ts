// Flow contract: query the ICA's existing read-only status protocol using the full stored credential type list, POST polling and a fresh thread; preserve good/revoked/unknown and reject substituted, stale or cross-origin results. No credential is issued or revoked by this client.
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { IcaCredentialStatusClient } from '../../../services/IcaCredentialStatusClient';
import { EXAMPLE_PROVIDER_ORGANIZATION_DID } from 'gdc-common-utils-ts/examples/shared';

describe('ICA current credential status protocol', () => {
  let server: Server; let origin: string;
  let status: string; let stale: boolean; let substitute: boolean; let crossOrigin: boolean;
  const credential = { id: `urn:uuid:${randomUUID()}`, issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID, type: ['VerifiableCredential', 'OrganizationCredential'] };
  let thread: string; const methods: string[] = []; let typePath: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, origin); methods.push(req.method!);
      if (url.pathname.endsWith('/_status')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString()); thread = input.thid; typePath = url.pathname;
        res.writeHead(202, { location: crossOrigin ? 'https://other.example/_status-response' : url.pathname.replace(/_status$/, '_status-response') }); res.end();
      } else {
        res.setHeader('content-type', 'application/didcomm-plain+json'); res.end(JSON.stringify({ body: { data: [{ response: { status: '200' }, resource: {
          thid: url.searchParams.get('thid'), status: 'resolved', credentialType: credential.type.join(','), content: [{ credentialId: substitute ? 'another-credential' : credential.id,
            status, checkedAt: new Date(Date.now() - (stale ? 120_000 : 0)).toISOString() }],
        } }] } }));
      }
    });
    server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Owned status listener has no leased address.');
    origin = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => { status = 'good'; stale = false; substitute = false; crossOrigin = false; methods.length = 0; });
  afterAll(async () => { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  const client = () => new IcaCredentialStatusClient({ allowLocalTestEndpoint: true,
    resolveEndpoint: async () => `${origin}/ica/cds-ES/v1/health-care/network/credentials/{credentialType}/_status` });
  it.each(['good', 'revoked', 'unknown'])('preserves the authoritative %s result', async expected => {
    status = expected; expect(await client().check(credential)).toMatchObject({ status: expected });
    expect(methods).toEqual(['POST', 'POST']); expect(typePath).toContain('VerifiableCredential,OrganizationCredential'); expect(thread).toBeTruthy();
  });
  it('rejects another credential result', async () => { substitute = true; await expect(client().check(credential)).rejects.toThrow(/credential|identifier/i); });
  it('rejects a stale status result', async () => { stale = true; await expect(client().check(credential)).rejects.toThrow(/fresh|stale|time/i); });
  it('rejects a cross-origin polling location', async () => { crossOrigin = true; await expect(client().check(credential)).rejects.toThrow(/origin|location/i); expect(methods).toEqual(['POST']); });
});
