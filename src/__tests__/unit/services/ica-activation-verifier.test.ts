// Flow contract: a non-demo host without Fabric authenticates ICA-issued activation credentials and their current status, binds the controller signing key to ICA authority, and rejects expired, revoked, substituted or incorrectly addressed presentations.
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { FlattenedSign, importJWK, jwtVerify, createLocalJWKSet } from 'jose';
import { buildOrganizationControllerPresentationVerifier } from '../../../bootstrap/build-organization-controller-presentation-verifier';
import { createOrganizationUrn } from '../../../utils/urn';
import { EntityLifecycleStatus } from '../../../gdc-backend-utils-node/models/enums';
import { EXAMPLE_HOST_PUBLIC_DID, EXAMPLE_TENANT_ROUTE_CONTEXT } from 'gdc-common-utils-ts/examples/shared';
import { createApiRouter } from '../../../routes/api';
import { TenantPresentationVerificationManager } from '../../../managers/TenantPresentationVerificationManager';
import { ReplayProtectionStoreMem } from '../../../adapters/replay-protection-store';
import canonicalize from 'canonicalize';
import { createServer, type Server } from 'node:http';
import { EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL, EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL, EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL, EXAMPLE_CONTROLLER_DID, EXAMPLE_PROVIDER_ORGANIZATION_DID, cloneExample } from 'gdc-common-utils-ts';
import { extractOrganizationLegalIdentifier } from 'gdc-common-utils-ts/utils/activation-policy';
import { IcaActivationVerifier } from '../../../services/IcaActivationVerifier';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { DefaultActivationTrustAdapter } from '../../../adapters/activation-trust.adapter';
import { buildActivationClearingHouse } from '../../../bootstrap/build-activation-clearing-house';
import { IcaCredentialStatusClient } from '../../../services/IcaCredentialStatusClient';
import { buildDeterministicSignedJwt, deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';

describe('ICA activation without Fabric', () => {
  const listeners: Server[] = [];
  const savedEnv = { ...process.env };
  afterEach(() => { process.env = { ...savedEnv }; });
  afterEach(async () => { for (const server of listeners.splice(0)) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); });
  async function fixture(options: { expired?: boolean; noExpiry?: boolean; wrongKey?: boolean; tampered?: boolean; wrongAudience?: boolean; inactiveIssuer?: boolean; servicePresentation?: boolean; serviceAudience?: string } = {}) {
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
    const legalId = extractOrganizationLegalIdentifier(organization);
    if (!legalId) throw new Error('The organization fixture must have a legal identifier.');
    const tenantId = legalId.value;
    const vp = await buildDeterministicSignedJwt({ seed: EXAMPLE_CONTROLLER_DID, purpose: 'ica-activation-actor', includePublicJwkInHeader: true,
      payload: { iss: actor.publicJwk.kid!, sub: options.servicePresentation ? tenantId : EXAMPLE_PROVIDER_ORGANIZATION_DID, aud: options.wrongAudience ? EXAMPLE_PROVIDER_ORGANIZATION_DID : options.serviceAudience || EXAMPLE_CONTROLLER_DID, iat: now, exp: now + 120, jti: 'activation-verification', vp: { verifiableCredential: credentials.map(credential => JSON.stringify(credential)) } } });
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
    const verifierOptions = { hostDid: EXAMPLE_CONTROLLER_DID,
      resolveIssuer: async () => ({ jwks: { keys: [root.publicJwk] }, status: options.inactiveIssuer ? 'inactive' : 'active' }),
      checkCredentialStatus: (credential: Record<string, any>) => client.check(credential),
    };
    const verifier = buildActivationClearingHouse(verifierOptions);
    const serviceVerifier = new IcaActivationVerifier(verifierOptions);
    return { verifier, serviceVerifier, tenantId, legalId, actorKey: actor.publicJwk, request: { tenantDid: EXAMPLE_CONTROLLER_DID, vpToken: vp.compactToken, acrValues: ['urn:antifraud:acr:openid4vp:employee'] },
      credentials, checked, setStatus: (value: string) => { status = value; } };
  }
  it('verifies the original three ICA credentials and reports no Fabric check', async () => {
    const f = await fixture();
    await expect(f.verifier.verifyVpToken(f.request)).resolves.toMatchObject({ ledgerVerified: false, trustChecks: { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false } });
    expect(f.checked).toHaveLength(3);
  });
  it('verifies the organization and service audience without claiming activation or Fabric evidence', async () => {
    const f = await fixture({servicePresentation: true});
    await expect(f.serviceVerifier.verifyServicePresentation(f.request.vpToken, EXAMPLE_CONTROLLER_DID, f.tenantId, f.legalId))
      .resolves.toMatchObject({ id: 'activation-verification' });
    expect(f.checked).toHaveLength(3);
    await expect(f.serviceVerifier.verifyServicePresentation(f.request.vpToken, EXAMPLE_PROVIDER_ORGANIZATION_DID, f.tenantId, f.legalId))
      .rejects.toThrow(/audience/i);
    await expect(f.serviceVerifier.verifyServicePresentation(f.request.vpToken, EXAMPLE_CONTROLLER_DID, 'unrelated-tenant', f.legalId))
      .rejects.toThrow(/tenant/i);
    await expect(f.serviceVerifier.verifyServicePresentation(f.request.vpToken, EXAMPLE_CONTROLLER_DID, f.tenantId,
      { ...f.legalId, value: 'unrelated-legal-id' })).rejects.toThrow(/different tenant/i);
    f.setStatus('revoked');
    await expect(f.serviceVerifier.verifyServicePresentation(f.request.vpToken, EXAMPLE_CONTROLLER_DID, f.tenantId, f.legalId)).rejects.toThrow(/status/i);
  });
  it('returns a signed Core HTTP response to the service holding the controller presentation', async () => {
    const requester = EXAMPLE_HOST_PUBLIC_DID;
    const f = await fixture({servicePresentation: true, serviceAudience: requester});
    const recipient = EXAMPLE_PROVIDER_ORGANIZATION_DID;
    const backend = deriveDeterministicEcJwkPair({seed: requester, purpose: 'organization-verification-service'});
    const responder = deriveDeterministicEcJwkPair({seed: recipient, purpose: 'organization-verification-response'});
    const route = EXAMPLE_TENANT_ROUTE_CONTEXT;
    const organizationUrn = createOrganizationUrn({namespace: 'unid', network: 'test', jurisdiction: route.jurisdiction, sector: route.sector,
      idType: f.legalId.type, idValue: f.legalId.value});
    let operational = true;
    let activeKey = backend.publicJwk;
    const tenants = {
      tenantExists: async () => true, isTenantOperational: async () => operational,
      getDidDocument: async () => ({id: recipient, controller: [EXAMPLE_CONTROLLER_DID]}),
      getTenantIdentifierUrn: async () => organizationUrn, getCollectionName: async () => 'organizations',
    } as any;
    const verifyOrganizationController = buildOrganizationControllerPresentationVerifier({
      network: 'test', tenantManager: tenants, icaVerifier: f.serviceVerifier,
      vaultRepository: {get: jest.fn(async (_collection, id) => id === EXAMPLE_CONTROLLER_DID ? {id, status: EntityLifecycleStatus.Active} : undefined)} as any,
      kmsService: {unprotectConfidentialData: async () => ({status: EntityLifecycleStatus.Active,
        didDocument: {id: EXAMPLE_CONTROLLER_DID, verificationMethod: [{publicKeyJwk: activeKey}]},
      })} as any,
    });
    const manager = new TenantPresentationVerificationManager({
      tenants, verifier: f.verifier, replay: new ReplayProtectionStoreMem(),
      resolveRequester: async (tenant, service) => {
        if (tenant !== recipient || service !== requester) throw new Error('Untrusted service.');
        return {jwks: {keys: [backend.publicJwk]}, capabilities: ['organization-controller-verifier']};
      },
      verifyOrganizationController,
      signResult: async (_vault, payload) => (await buildDeterministicSignedJwt({
        seed: recipient, purpose: 'organization-verification-response', payload,
      })).compactToken,
    });
    const app = express();
    app.use(express.json());
    let origin = '';
    app.use((req, res, next) => createApiRouter({} as any, tenants, {} as any, {} as any, {} as any, {} as any, origin,
      undefined, undefined, undefined, undefined, undefined, manager)(req, res, next));
    const listener = app.listen(0, '127.0.0.1');
    listeners.push(listener);
    await new Promise<void>((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Owned test listener is unavailable.');
    origin = `http://127.0.0.1:${address.port}`;
    const endpoint = `${origin}/${f.tenantId}/cds-${route.jurisdiction}/v1/${route.sector}/identity/openid/presentation/_verify`;
    const body = {verification_profile: 'organization-controller', nonce: randomUUID(), vp_token: f.request.vpToken};
    const send = async () => {
      const now = Math.floor(Date.now() / 1000);
      const assertion = await buildDeterministicSignedJwt({seed: requester, purpose: 'organization-verification-service',
        payload: {iss: requester, sub: requester, aud: endpoint, iat: now, exp: now + 60, jti: randomUUID(),
          request_hash: createHash('sha256').update(canonicalize(body)!).digest('hex')},
      });
      return fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${assertion.compactToken}`},
        body: JSON.stringify(body)});
    };
    expect((await send()).status).toBe(403);
    activeKey = f.actorKey;
    const response = await send();
    expect(response.status).toBe(200);
    const receipt = await jwtVerify(await response.text(), createLocalJWKSet({keys: [responder.publicJwk]}), {
      issuer: recipient, audience: requester,
    });
    expect(receipt.payload).toMatchObject({verified: true, sub: f.tenantId, nonce: body.nonce, jurisdiction: route.jurisdiction,
      vp_hash: createHash('sha256').update(body.vp_token).digest('hex')});
    expect(receipt.payload.ledger_verified).toBeUndefined();
    expect((await send()).status).toBe(403);
    operational = false;
    expect((await send()).status).toBe(403);
  });
  it.each(['test', 'local-network', 'test-network', 'network'] as const)('activates an ICA-authorized first controller in %s without claiming a Fabric check', async networkMode => {
    process.env.SECURITY_MODE = 'strict'; process.env.NETWORK_MODE = networkMode;
    // An operational presentation selector must not replace first-controller ICA proof.
    process.env.CLEARING_HOUSE_MODE = 'stub';
    const f = await fixture();
    const adapter = new DefaultActivationTrustAdapter(f.verifier);
    const input = { networkMode, vpToken: f.request.vpToken, verifierTenantDid: EXAMPLE_CONTROLLER_DID,
      organizationCredential: f.credentials[0], representativeCredential: f.credentials[1], controllerCredential: f.credentials[2] };
    await expect(adapter.evaluate(input)).resolves.toMatchObject({ clearingHouse: { ledgerVerified: false },
      trustPolicy: { revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false } });
    expect(f.checked).toHaveLength(3);
    f.setStatus('revoked');
    await expect(adapter.evaluate(input)).rejects.toThrow(/status|active|revoked/i);
  });
  it('rejects native ICA evidence attached to another presentation', async () => {
    process.env.SECURITY_MODE = 'strict'; process.env.NETWORK_MODE = 'network';
    const f = await fixture();
    const adapter = new DefaultActivationTrustAdapter({ verifyVpToken: async request => ({
      ...await f.verifier.verifyVpToken(request), vpHash: 'different-presentation',
    }) });
    await expect(adapter.evaluate({ networkMode: 'network', vpToken: f.request.vpToken, verifierTenantDid: EXAMPLE_CONTROLLER_DID,
      organizationCredential: f.credentials[0], representativeCredential: f.credentials[1], controllerCredential: f.credentials[2] })).rejects.toThrow(/evidence.*presentation/i);
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
