// Flow contract: a non-demo host without Fabric authenticates ICA-issued activation credentials and their current status, binds the controller signing key to ICA authority, and rejects expired, revoked, substituted or incorrectly addressed presentations.
import canonicalize from 'canonicalize';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { FlattenedSign, importJWK } from 'jose';
import { EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL, EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL, EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL, EXAMPLE_CONTROLLER_DID, EXAMPLE_PROVIDER_ORGANIZATION_DID, cloneExample } from 'gdc-common-utils-ts';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { IcaActivationVerifier } from '../../../services/IcaActivationVerifier';
import { IcaCredentialStatusClient } from '../../../services/IcaCredentialStatusClient';
import { buildDeterministicSignedJwt, deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';

describe('ICA activation without Fabric', () => {
  const listeners: Server[] = [];
  afterEach(async () => { for (const server of listeners.splice(0)) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  async function fixture(options: { expired?: boolean; noExpiry?: boolean; wrongKey?: boolean; tampered?: boolean; wrongAudience?: boolean; inactiveIssuer?: boolean } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const actor = deriveDeterministicEcJwkPair({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'ica-activation-actor' });
    const root = deriveDeterministicEcJwkPair({ seed: EXAMPLE_PROVIDER_ORGANIZATION_DID, purpose: 'ica-activation-root' });
    const organization: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organization.credentialSubject.id = EXAMPLE_PROVIDER_ORGANIZATION_DID;
    const representative: any = cloneExample(EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL);
    const controller: any = cloneExample(EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL);
    controller.credentialSubject.owner.hasCredential = { material: toJwkThumbprintSha256Urn((options.wrongKey ? root : actor).publicJwk as any) };
    const credentials = [];
    for (const input of [organization, representative, controller]) {
      const credential = { ...input, id: `urn:uuid:${randomUUID()}`, issuer: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        issuanceDate: new Date((now - 60) * 1000).toISOString(), expirationDate: new Date((now + (options.expired ? -10 : 300)) * 1000).toISOString() };
      delete credential.proof;
      if (options.noExpiry) delete credential.expirationDate;
      const method = `${credential.issuer}#${root.publicJwk.kid}`;
      const signed = await new FlattenedSign(Buffer.from(canonicalize(credential)!)).setProtectedHeader({ alg: 'ES384', kid: method, b64: false, crit: ['b64'] }).sign(await importJWK(root.privateJwk, 'ES384'));
      credentials.push({ ...credential, proof: { type: 'JsonWebSignature2020', verificationMethod: method, proofPurpose: 'assertionMethod', jws: `${signed.protected}..${signed.signature}` } });
    }
    if (options.tampered) credentials[0].credentialSubject = { ...credentials[0].credentialSubject, legalName: 'altered' };
    const vp = await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'ica-activation-actor', includePublicJwkInHeader: true,
      payload: { iss: actor.publicJwk.kid!, sub: EXAMPLE_PROVIDER_ORGANIZATION_DID, aud: options.wrongAudience ? EXAMPLE_PROVIDER_ORGANIZATION_DID : EXAMPLE_CONTROLLER_DID, iat: now, exp: now + 120, jti: 'activation-verification', vp: { verifiableCredential: credentials.map(credential => JSON.stringify(credential)) } } });
    let status = 'good'; const checked: string[] = [];
    let origin: string;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, origin);
      if (url.pathname.endsWith('/_status')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const input = JSON.parse(Buffer.concat(chunks).toString());
        const poll = new URL(url.pathname.replace(/_status$/, '_status-response'), origin);
        poll.searchParams.set('thid', input.thid); poll.searchParams.set('credentialId', input.body.data[0].credentialId);
        res.writeHead(202, { location: poll.href }); res.end();
      } else {
        const id = url.searchParams.get('credentialId')!; checked.push(id);
        res.setHeader('content-type', 'application/didcomm-plain+json');
        res.end(JSON.stringify({ body: { data: [{ response: { status: '200' }, resource: { status: 'resolved', thid: url.searchParams.get('thid'),
          credentialType: url.pathname.split('/').at(-2), content: [{ credentialId: id, status, checkedAt: new Date().toISOString() }] } }] } }));
      }
    });
    listeners.push(server); server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Owned ICA listener is unavailable.');
    origin = `http://127.0.0.1:${address.port}`;
    const client = new IcaCredentialStatusClient({ allowLocalTestEndpoint: true, resolveEndpoint: () => `${origin}/ica/cds-ES/v1/health-care/network/credentials/{credentialType}/_status` });
    const verifier = new IcaActivationVerifier({ hostDid: EXAMPLE_CONTROLLER_DID,
      resolveIssuer: async () => ({ jwks: { keys: [root.publicJwk] }, status: options.inactiveIssuer ? 'inactive' : 'active' }),
      checkCredentialStatus: credential => client.check(credential),
    });
    return { verifier, request: { tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: vp.compactToken, acrValues: ['urn:antifraud:acr:openid4vp:employee'] },
      checked, setStatus: (value: string) => { status = value; } };
  }
  it('verifies the original three ICA credentials and reports no Fabric check', async () => {
    const f = await fixture();
    await expect(f.verifier.verifyVpToken(f.request)).resolves.toMatchObject({ ledgerVerified: false, trustChecks: { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false } });
    expect(f.checked).toHaveLength(3);
  });
  it('accepts an ICA credential without an optional expiry only after checking its current status', async () => {
    const f = await fixture({ noExpiry: true });
    await expect(f.verifier.verifyVpToken(f.request)).resolves.toMatchObject({ ledgerVerified: false });
    expect(f.checked).toHaveLength(3); f.setStatus('revoked');
    await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/status|active/i);
  });
  it.each(['revoked', 'unknown'])('rejects the same presentation after an ICA status change to %s', async status => {
    const f = await fixture(); await f.verifier.verifyVpToken(f.request); f.setStatus(status);
    await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow(/status|active|revoked/i);
  });
  it.each(['expired', 'wrongKey', 'tampered', 'wrongAudience', 'inactiveIssuer'] as const)('rejects %s', async option => {
    const f = await fixture({ [option]: true }); await expect(f.verifier.verifyVpToken(f.request)).rejects.toThrow();
  });
});
