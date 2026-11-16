// Flow contract: 1) persist a real encrypted DCR profile, active licence and employee; 2) validate the canonical professional identity projection against those records; 3) persist revocation/expiry/role changes and prove denial; 4) zeroize the owned KMS. No Fabric, demo authority or mocked key custody replaces this local registry proof.
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { randomUUID } from 'node:crypto';
import { buildProfessionalIdentityVpPayload, buildProfessionalEmployeeCredential } from 'gdc-common-utils-ts/utils/professional-smart';
import { EXAMPLE_PROFESSIONAL_IDENTITY } from 'gdc-common-utils-ts/examples/employee';
import { EXAMPLE_DEVICE_CLIENT_ID, EXAMPLE_TENANT_ROUTE_CONTEXT, EXAMPLE_LEGAL_ORGANIZATION_TAX_ID, EXAMPLE_CONTROLLER_EMAIL, EXAMPLE_API_ORGANIZATION_DID, EXAMPLE_RESEARCH_API_ORGANIZATION_DID, EXAMPLE_RESEARCH_TENANT_IDENTIFIER } from 'gdc-common-utils-ts/examples/shared';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { verifyRegisteredProfessionalIdentity } from '../../../bootstrap/verify-registered-presentation-identity';
import { KmsService } from '../../../services/KmsService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { createEmployeeUrn } from '../../../utils/urn';
import { resolveProfessionalHomeVault } from '../../../bootstrap/resolve-professional-home-vault';
import { buildLocalClearingHouseVerifier } from '../../../bootstrap/build-clearing-house-verifier';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';
import { testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { getTenantVaultId } from '../../../utils/tenant';
import { getEnvSectionId } from '../../../utils/section-env';
import { URN_NAMESPACE, URN_NETWORK, URN_VERSION, URN_ORGANIZATION_ID_TYPE } from '../../data/urn.data';

describe('current protected professional identity state', () => {
  it('validates current employment and licence without Fabric and denies revoked or expired authority', async () => {
    const saved = { ...process.env }; process.env.NODE_ENV = 'test'; process.env.NETWORK_MODE = 'test'; process.env.SECURITY_MODE = 'strict';
    const crypto = new CryptographyService(new AdapterCryptoSdkNode());
    const vault = new VaultMemRepository(); let kms: KmsService;
    const tenants = new TenantsCacheManager(vault, () => kms, 'test-host-collection');
    kms = new KmsService(crypto, tenants);
    try {
      await kms.init();
      const route = EXAMPLE_TENANT_ROUTE_CONTEXT;
      const vaultId = getTenantVaultId(route.sector, route.tenantId); await kms.provisionKeys(vaultId);
      const identity = EXAMPLE_PROFESSIONAL_IDENTITY;
      const tenantDid = EXAMPLE_API_ORGANIZATION_DID;
      const tenantClaims = { ...testClaimsTenant1Registration, [ClaimsOrganizationSchemaorg.alternateName]: route.tenantId };
      const registration = await kms.protectConfidentialData({ id: vaultId, status: 'active', sequence: 0,
        content: { id: vaultId, status: 'active', claims: tenantClaims, didDocument: { id: tenantDid }, meta: { lastUpdated: new Date().toISOString() } } } as any, 'host');
      await vault.put('test-host-collection', [registration], getEnvSectionId('tenants')); await tenants.refreshTenant(vaultId);
      const employeeCollection = (await tenants.getCollectionName(vaultId))!;
      const indexVaultId = getTenantVaultId(route.sector, EXAMPLE_RESEARCH_TENANT_IDENTIFIER);
      const indexDid = EXAMPLE_RESEARCH_API_ORGANIZATION_DID;
      const indexRegistration = await kms.protectConfidentialData({ id: indexVaultId, status: 'active', sequence: 0, content: { id: indexVaultId, status: 'active',
        claims: { ...tenantClaims, [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_RESEARCH_TENANT_IDENTIFIER }, didDocument: { id: indexDid }, meta: { lastUpdated: new Date().toISOString() } } } as any, 'host');
      await vault.put('test-host-collection', [indexRegistration], getEnvSectionId('tenants')); await tenants.refreshTenant(indexVaultId);
      const walletVault = 'local-test-professional-wallet'; await kms.provisionKeys(walletVault);
      const walletKey = await kms.getPublicVerificationKey(walletVault, undefined, 'comm_sig');

      const employeeUrn = createEmployeeUrn({ namespace: URN_NAMESPACE, network: URN_NETWORK, jurisdiction: route.jurisdiction,
        version: URN_VERSION, sector: route.sector, idType: URN_ORGANIZATION_ID_TYPE, idValue: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
        email: identity.email, role: identity.role });
      const now = Math.floor(Date.now() / 1000);
      const profile = { clientId: EXAMPLE_DEVICE_CLIENT_ID, subjectId: employeeUrn, activationCode: 'local-test-professional-activation', jwks: { keys: [walletKey] } };
      const licence = { id: 'local-test-professional-seat', status: 'active', subjectId: employeeUrn, activationCode: profile.activationCode,
        issuedToRole: identity.role, exp: now + 600, deviceBindings: [{ clientId: profile.clientId, status: 'active' }] };
      const employee = { status: 'active', didDocument: { id: identity.actorDid }, claims: {
        [ClaimsPersonSchemaorg.email]: identity.email, [ClaimsPersonSchemaorg.hasOccupation]: identity.role,
      } };
      const store = async (id: string, section: string, content: Record<string, unknown>) => {
        const doc = await kms.protectConfidentialData({ id, status: content.status || 'active', sequence: 0, content } as any, vaultId);
        await vault.put(section === 'employees' ? employeeCollection : vaultId, [doc], getEnvSectionId(section));
      };
      await store(profile.clientId, 'device-profiles', profile); await store(licence.id, 'device-licenses', licence); await store(employeeUrn, 'employees', employee);
      const credential = buildProfessionalEmployeeCredential({ actorDid: identity.actorDid, role: identity.role });
      const verifier = buildLocalClearingHouseVerifier({ network: 'test', ledgerKind: 'memory', tenants, ledger: new CredentialLedgerAdapterMem(),
        cryptography: crypto, kmsService: kms, vaultRepository: vault, authorize: async () => { throw new Error('No scoped data request in this identity proof.'); } });
      const clientAuth = new OpenIdAuthManager(kms, tenants, vault, verifier, undefined, { cryptography: crypto, resolveClientRegistrationVault: (actor, fallback) => resolveProfessionalHomeVault(tenants, actor, fallback) });
      const verify = async () => {
        const assertion = await kms.createCompactJws({ iss: profile.clientId, sub: profile.clientId, aud: indexDid, iat: now, exp: now + 60, jti: randomUUID() }, walletKey.kid!, walletVault, 'comm_sig');
        const authenticated = await (clientAuth as any).validateClientAssertion({ clientId: profile.clientId, tenantVaultId: indexVaultId, issuerDid: indexDid,
          body: { sub: identity.actorDid, client_assertion_type: 'private_key_jwt', client_assertion: assertion } });
        const vpToken = await kms.createCompactJws({ iss: walletKey.kid, sub: identity.actorDid,
          ...buildProfessionalIdentityVpPayload({ clientId: profile.clientId, actorDid: identity.actorDid, role: identity.role, verifiableCredential: credential }) }, walletKey.kid!, walletVault, 'comm_sig');
        return verifier.verifyVpToken({ tenantDid: indexDid, tenantVaultId: indexVaultId, holderVaultId: authenticated.registeredAtVaultId, authenticatedClientId: authenticated.clientId,
          vpToken, tokenSubject: identity.actorDid, acrValues: ['urn:antifraud:acr:openid4vp:employee'] });
      };
      expect(await verify()).toMatchObject({ acr: 'urn:antifraud:acr:openid4vp:employee', trustChecks: { onChainChecked: false } });
      expect(await vault.get(indexVaultId, profile.clientId, getEnvSectionId('device-profiles'))).toBeUndefined();
      const forgedAlias = buildProfessionalEmployeeCredential({ actorDid: identity.actorDid, role: identity.role, email: EXAMPLE_CONTROLLER_EMAIL, EXAMPLE_API_ORGANIZATION_DID, EXAMPLE_RESEARCH_API_ORGANIZATION_DID, EXAMPLE_RESEARCH_TENANT_IDENTIFIER });
      await expect(verifyRegisteredProfessionalIdentity({ credential: forgedAlias, holder: profile.clientId, vaultId, employeeCollection,
        kmsService: kms, vaultRepository: vault, now })).rejects.toThrow(/alias|identity/i);
      await store(employeeUrn, 'employees', { ...employee, status: 'inactive' }); await expect(verify()).rejects.toThrow(/employee|employment/i);
      await store(employeeUrn, 'employees', employee);
      await store(licence.id, 'device-licenses', { ...licence, status: 'revoked' }); await expect(verify()).rejects.toThrow(/licen/i);
      await store(licence.id, 'device-licenses', { ...licence, exp: now - 1 }); await expect(verify()).rejects.toThrow(/licen|expir/i);
      await store(licence.id, 'device-licenses', { ...licence, issuedToRole: 'RESPRSN' }); await expect(verify()).rejects.toThrow(/role|licen/i);
    } finally { kms.destroy(); process.env = saved; }
  }, 30_000);
});
