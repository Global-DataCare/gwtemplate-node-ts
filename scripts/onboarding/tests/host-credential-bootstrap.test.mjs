// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * Journey:
 * 1. The host operator receives one activation file from the data-space ICA operator.
 * 2. The host generates one P-384 request-signing key under private custody.
 * 3. The operator submits the exact approved host metadata, activation and signed request.
 * 4. The ICA returns the HostingServiceCredential as JSON VC and compact VC-JWT.
 * Authorization invariant: activation and signature bind domain, controller, legal identity, sector and network.
 * Persistence invariant: activation, private JWK and returned credential bundle are mode 0600 and never printed.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  initializeHostRequestKey,
  requestHostCredential,
} from '../request-host-credential.mjs';

test('uses one activation and a locally generated request key to obtain a governed Host VC without a PDF', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'host-credential-bootstrap-'));
  const privateJwkFile = join(root, 'host-signing.private.jwk.json');
  const activationFile = join(root, 'host-activation.json');
  const credentialOutputFile = join(root, 'host-credential.json');
  const hostDomain = 'host.provider.example';
  const controllerEmail = 'controller@provider.example';
  const organizationTaxId = 'VAT-EXAMPLE-001';
  const received = [];
  const receivedAuthorization = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received.push(JSON.parse(body));
        receivedAuthorization.push(request.headers.authorization);
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

  await writeFile(activationFile, JSON.stringify({
    domain: hostDomain,
    networkKind: 'network',
    expiresAt: '2099-09-05T12:00:00.000Z',
    approval: {
      jurisdiction: 'ES',
      sector: 'health-care',
      legalName: 'Example Hosting Provider',
      addressCountry: 'ES',
      controllerEmail,
      serviceUrl: `https://${hostDomain}`,
      taxId: organizationTaxId,
    },
    activationCode: 'ica_host_test_activation_code',
  }), { mode: 0o600 });
  await initializeHostRequestKey({ hostDomain, privateJwkFile });
  assert.equal((await stat(privateJwkFile)).mode & 0o777, 0o600);

  await assert.rejects(
    requestHostCredential({
      verifyUrl: `http://127.0.0.1:${address.port}/ica/cds-ES/v1/health-care/network/pdf/contract/_verify`,
      hostDomain,
      serviceUrl: `https://${hostDomain}`,
      jurisdiction: 'ES',
      sector: 'health-care',
      networkKind: 'network',
      legalName: 'Example Hosting Provider',
      addressCountry: 'ES',
      taxId: organizationTaxId,
      controllerEmail: 'different-controller@provider.example',
      privateJwkFile,
      activationFile,
      credentialOutputFile,
    }),
    /does not match the approved host data/i,
  );
  assert.equal(received.length, 0);

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
    activationFile,
    credentialOutputFile,
  });

  assert.equal(received.length, 1);
  assert.deepEqual(receivedAuthorization, ['HostActivation ica_host_test_activation_code']);
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
