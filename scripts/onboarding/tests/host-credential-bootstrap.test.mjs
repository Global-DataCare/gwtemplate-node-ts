// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Journey:
 * 1. The host operator generates one P-384 bootstrap identity under private custody.
 * 2. The public DID document is delivered to the data-space ICA authority for pinning.
 * 3. The operator submits the exact approved host metadata and route in a signed request.
 * 4. The ICA returns the HostingServiceCredential as JSON VC and compact VC-JWT.
 * Authorization invariant: the request signature binds domain, controller, legal identity, sector and network.
 * Persistence invariant: private JWK and returned credential bundle are mode 0600 and never printed.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initializeHostBootstrapIdentity,
  requestHostCredential,
} from '../request-host-credential.mjs';

test('generates the host identity and obtains a governed Host VC without a PDF', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'host-credential-bootstrap-'));
  const privateJwkFile = join(root, 'host-signing.private.jwk.json');
  const didDocumentFile = join(root, 'did.json');
  const credentialOutputFile = join(root, 'host-credential.json');
  const hostDomain = 'host.provider.example';
  const controllerEmail = 'controller@provider.example';
  const organizationTaxId = 'VAT-EXAMPLE-001';
  const received = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received.push(JSON.parse(body));
        response.writeHead(202, { location: '/jobs/host-credential-001' });
        response.end();
      });
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      body: {
        data: [{
          resource: {
            id: 'urn:uuid:host-credential-001',
            type: ['VerifiableCredential', 'ServiceCredential', 'HostingServiceCredential'],
            credentialSubject: { id: `https://${hostDomain}` },
          },
        }],
      },
      attachments: [{
        data: { json: { credentialId: 'urn:uuid:host-credential-001', jwt: 'header.payload.signature' } },
      }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  await initializeHostBootstrapIdentity({ hostDomain, privateJwkFile, didDocumentFile });
  const didDocument = JSON.parse(await readFile(didDocumentFile, 'utf8'));
  assert.equal(didDocument.id, `did:web:${hostDomain}`);
  assert.equal('d' in didDocument.verificationMethod[0].publicKeyJwk, false);
  assert.equal((await stat(privateJwkFile)).mode & 0o777, 0o600);

  await requestHostCredential({
    verifyUrl: `http://127.0.0.1:${address.port}/ica/cds-ES/v1/health-care/network/pdf/contract/_verify`,
    hostDomain,
    serviceUrl: `https://${hostDomain}`,
    jurisdiction: 'ES',
    sector: 'health-care',
    networkKind: 'network',
    legalName: 'Example Hosting Provider',
    addressCountry: 'ES',
    taxId: organizationTaxId,
    controllerEmail,
    privateJwkFile,
    credentialOutputFile,
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].iss, `did:web:${hostDomain}`);
  assert.equal(received[0].body.data[0].resource.meta.claims['org.schema.Service.owner.email'], controllerEmail);
  assert.equal(received[0].body.data[0].resource.meta.claims['org.schema.Organization.taxID'], organizationTaxId);
  const compact = received[0].body.hostAuthorizationProof.jws.split('.');
  assert.equal(compact.length, 3);
  const signed = JSON.parse(Buffer.from(compact[1], 'base64url').toString('utf8'));
  assert.equal(signed.networkKind, 'network');
  assert.equal(signed.resource.meta.claims['org.schema.Service.owner.email'], controllerEmail);

  const result = JSON.parse(await readFile(credentialOutputFile, 'utf8'));
  assert.equal(result.credential.type.includes('HostingServiceCredential'), true);
  assert.equal(result.vcJwt, 'header.payload.signature');
  assert.equal((await stat(credentialOutputFile)).mode & 0o777, 0o600);
});
