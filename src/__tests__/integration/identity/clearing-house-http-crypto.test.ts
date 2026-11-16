// Flow contract: 1) persist tenant and DCR state under real KMS protection; 2) sign issuer VC and holder VP; 3) authenticate an HTTP verification request with ML-DSA; 4) verify the returned tenant signature; 5) enforce current consent; 6) revoke the credential, key and consent and prove denial; 7) close the owned ephemeral listener and zeroize KMS. No demo authentication, mocked fetch, crypto or ledger decisions. This is local memory-ledger proof, not Fabric evidence.
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { buildProfessionalEmployeeCredential } from 'gdc-common-utils-ts/utils/professional-smart';
import { EXAMPLE_CONTROLLER_DID, EXAMPLE_PROVIDER_ORGANIZATION_DID, EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, EXAMPLE_TENANT_ROUTE_CONTEXT, EXAMPLE_PROFESSIONAL_DID, EXAMPLE_DEVICE_CLIENT_ID, EXAMPLE_SUBJECT_DID, EXAMPLE_HOST_PUBLIC_DID } from 'gdc-common-utils-ts/examples/shared';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { ClaimConsent, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { parseActorFromSub } from 'gdc-common-utils-ts/utils/actor';
import { buildScopeSmartCompositionAccess } from 'gdc-common-utils-ts/utils/smart-scope';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/healthcare';
import { createHostedDidWeb } from '../../../utils/did-backend';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';
import { testConsentRulePermitOrgDid } from '../../data/consent-rules.data';
import { KmsService } from '../../../services/KmsService';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { TenantPresentationVerificationManager } from '../../../managers/TenantPresentationVerificationManager';
import { buildLocalClearingHouseVerifier } from '../../../bootstrap/build-clearing-house-verifier';
import { ClearingHouseService } from '../../../services/ClearingHouseService';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';
import { ReplayProtectionStoreMem } from '../../../adapters/replay-protection-store';
import { createApiRouter } from '../../../routes/api';
import { getTenantVaultId } from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { buildDeterministicSignedJwt, deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';

describe('real authenticated Clearing House HTTP boundary', () => {
  it('verifies real signatures and rejects the same VP after authoritative local revocation', async () => {
    const saved = { ...process.env };
    process.env.NODE_ENV = 'test'; process.env.NETWORK_MODE = 'test'; process.env.SECURITY_MODE = 'strict'; process.env.CLEARING_HOUSE_MODE = 'remote';
    const crypto = new CryptographyService(new AdapterCryptoSdkNode());
    const vault = new VaultMemRepository();
    let kms: KmsService;
    const tenants = new TenantsCacheManager(vault, () => kms, 'test-host-collection');
    kms = new KmsService(crypto, tenants);
    let server: Server | undefined;
    try {
      await kms.init();
      const route = EXAMPLE_TENANT_ROUTE_CONTEXT;
      const tenantVault = getTenantVaultId(route.sector, route.tenantId);
      await kms.provisionKeys(tenantVault);
      const signingKey = await kms.getPublicVerificationKey(tenantVault, undefined, 'comm_sig');
      expect(signingKey.alg).toBe('ML-DSA-44');
      const tenantDid = createHostedDidWeb(EXAMPLE_HOST_PUBLIC_DID, route.tenantId, { ...route, version: 'v1' });
      const actorDid = EXAMPLE_PROFESSIONAL_DID;
      const holderId = EXAMPLE_DEVICE_CLIENT_ID;
      const requesterDid = EXAMPLE_CONTROLLER_DID;
      const registration = await kms.protectConfidentialData({ id: tenantVault, status: 'active', sequence: 0,
        content: { id: tenantVault, status: 'active', claims: testClaimsTenant1Registration, didDocument: { id: tenantDid }, meta: { lastUpdated: new Date().toISOString() } } } as any, 'host');
      await vault.put('test-host-collection', [registration], getEnvSectionId('tenants'));
      await tenants.refreshTenant(tenantVault);
      expect(await tenants.tenantExists(tenantVault)).toBe(true);
      const now = Math.floor(Date.now() / 1000);
      const credentialId = randomUUID();
      const holderPublicKey = deriveDeterministicEcJwkPair({ seed: requesterDid, purpose: 'http-professional-holder' }).publicJwk;
      const vc = await buildDeterministicSignedJwt({ seed: tenantDid, purpose: 'http-professional-issuer', payload: {
        ...buildProfessionalEmployeeCredential({ actorDid, role: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, credentialMaterial: toJwkThumbprintSha256Urn(holderPublicKey as any) }),
        id: credentialId, iss: tenantDid, issuer: tenantDid, iat: now, exp: now + 120, jti: credentialId,
      } });
      const acr = 'urn:antifraud:acr:openid4vp:employee';
      const vp = await buildDeterministicSignedJwt({ seed: requesterDid, purpose: 'http-professional-holder', payload: {
        iss: holderId, aud: tenantDid, iat: now, exp: now + 120, jti: randomUUID(), acr,
        vp: { type: ['VerifiablePresentation'], verifiableCredential: [vc.compactToken] },
      } });
      const device = await kms.protectConfidentialData({ id: holderId, status: 'active', sequence: 0,
        content: { clientId: holderId, jwks: { keys: [vp.publicJwk] } } } as any, tenantVault);
      await vault.put(tenantVault, [device], getEnvSectionId('device-profiles'));
      const ledger = new CredentialLedgerAdapterMem();
      ledger.seedStatus('test', { id: credentialId, issuer: tenantDid, status: 'active', updatedAt: now });
      process.env.CREDENTIAL_TRUSTED_ISSUERS_JSON = JSON.stringify({ [tenantDid]: { status: 'active', jwks: { keys: [vc.publicJwk] } } });
      let consentManager: OpenIdAuthManager;
      const rule = { ...testConsentRulePermitOrgDid, [ClaimConsent.subject]: EXAMPLE_SUBJECT_DID,
        [ClaimConsent.actorIdentifier]: actorDid, [ClaimConsent.actorRole]: parseActorFromSub(actorDid).role };
      const rulesSection = getIndividualSectionId(EXAMPLE_SUBJECT_DID, 'rules');
      await vault.put(tenantVault, [rule], rulesSection);
      const verifier = buildLocalClearingHouseVerifier({ network: 'test', ledgerKind: 'memory', ledger, tenants,
        cryptography: crypto, kmsService: kms, vaultRepository: vault,
        authorize: request => consentManager.verifyCurrentConsentContext(request),
      });
      consentManager = new OpenIdAuthManager(kms, tenants, vault, verifier);
      const manager = new TenantPresentationVerificationManager({ tenants, verifier, replay: new ReplayProtectionStoreMem(), cryptography: crypto,
        resolveRequester: async (recipient, requester) => {
          if (recipient !== tenantDid || requester !== requesterDid) throw new Error('Untrusted backend.');
          return { jwks: { keys: [signingKey as any] }, capabilities: ['verifier'] };
        },
        signResult: async (vaultId, payload) => kms.createCompactJws(payload, signingKey.kid!, vaultId, 'comm_sig'),
      });
      let origin = '';
      const app = express(); app.use(express.json());
      // The production router receives the exact leased origin, never a browser-supplied Host authority.
      app.use((req, res, next) => createApiRouter({} as any, tenants, kms, {} as any, vault, crypto, origin,
        undefined, undefined, undefined, undefined, undefined, manager)(req, res, next));
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve, reject) => { server!.once('listening', resolve); server!.once('error', reject); });
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Owned listener has no leased address.');
      origin = `http://127.0.0.1:${address.port}`;
      const endpoint = `${origin}/${route.tenantId}/cds-${route.jurisdiction}/v1/${route.sector}/identity/openid/presentation/_verify`;
      const service = new ClearingHouseService({ cryptography: crypto, allowLocalTestEndpoint: true,
        resolveTrust: async () => ({ homeTenantReference: requesterDid, sourceTenant: { tenantReference: tenantDid, endpoint, capabilities: ['verifier'] },
          trustedFederatedTenantReferences: [tenantDid], issuer: tenantDid, audience: requesterDid, jwks: { keys: [signingKey as any] } }),
        signClientAssertion: async ({ audience, requestHash }) => kms.createCompactJws({ iss: requesterDid, sub: requesterDid, aud: audience,
          iat: now, exp: now + 60, jti: randomUUID(), request_hash: requestHash }, signingKey.kid!, tenantVault, 'comm_sig'),
      });
      const request = { tenantDid: requesterDid, vpToken: vp.compactToken, acrValues: [acr], tokenSubject: actorDid, tokenIssuer: tenantDid,
        tokenPurpose: rule[ClaimConsent.purpose], consentIdentifiers: [rule[ClaimConsent.identifier]],
        tokenScope: buildScopeSmartCompositionAccess({ subjectDid: EXAMPLE_SUBJECT_DID, sections: [HealthcareBasicSections.AllergiesAndIntolerances.attributeValue], accessVerb: 'rs' }) };
      expect(await verifier.verifyVpToken({ ...request, tenantDid, tenantVaultId: tenantVault })).toMatchObject({ ledgerVerified: true, trustChecks: { onChainChecked: false } });
      expect(await service.verifyVpToken(request)).toMatchObject({ ledgerVerified: true, trustChecks: { onChainChecked: false, revocationChecked: true } });
      const anonymous = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(anonymous.status).toBe(401);
      ledger.seedStatus('test', { id: credentialId, issuer: tenantDid, status: 'revoked', updatedAt: now + 1 });
      await expect(service.verifyVpToken(request)).rejects.toThrow(/403/);
      ledger.seedStatus('test', { id: credentialId, issuer: tenantDid, status: 'active', updatedAt: now + 2 });
      await vault.put(tenantVault, [{ ...device, status: 'revoked' }], getEnvSectionId('device-profiles'));
      await expect(service.verifyVpToken(request)).rejects.toThrow(/403/);
      await vault.put(tenantVault, [device], getEnvSectionId('device-profiles'));
      await vault.put(tenantVault, [{ ...rule, [ClaimConsent.status]: ConsentStatuses.Inactive }], rulesSection);
      await expect(service.verifyVpToken(request)).rejects.toThrow(/403/);
      await vault.put(tenantVault, [{ ...rule, [ClaimConsent.decision]: 'deny' }], rulesSection);
      await expect(service.verifyVpToken(request)).rejects.toThrow(/403/);
    } finally {
      if (server) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()); server!.closeAllConnections(); });
      kms.destroy(); process.env = saved;
    }
  }, 30_000);
});
