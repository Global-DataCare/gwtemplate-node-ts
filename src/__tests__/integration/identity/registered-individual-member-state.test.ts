// Flow contract: 1) persist encrypted index/custodian tenants, personal licences and system registrations; 2) authenticate a real wallet assertion and canonical SDK VP; 3) issue only the controller's default or the member's consented SMART scope; 4) authenticate the EHR to its own tenant and verify a signed, request-bound response; 5) deny invalid signatures, wrong subjects, expanded scopes and revoked authority; 6) zeroize the owned KMS. No Fabric evidence or mocked authentication is claimed.
import { randomUUID } from 'node:crypto';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { buildIndividualMemberDidWeb } from 'gdc-common-utils-ts/utils/did';
import { getIndividualMemberIdentityVC, buildIndividualMemberIdentityVpPayload } from 'gdc-common-utils-ts/utils/individual-smart';
import { getOrganizationDidFromIndividualDid } from 'gdc-common-utils-ts/utils/did-resolution';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EXAMPLE_SUBJECT_DID, EXAMPLE_SUBJECT_DID_SECONDARY, EXAMPLE_ACCOUNT_OWNER_ID, EXAMPLE_CONTROLLER_EMAIL, EXAMPLE_RELATED_PERSON_ROLE, EXAMPLE_RELATED_PERSON_INACTIVE_RELATIONSHIP, EXAMPLE_DEVICE_CLIENT_ID, EXAMPLE_SECURE_ID_VALUE_INDIVIDUAL_CONTROLLER, EXAMPLE_TENANT_ROUTE_CONTEXT } from 'gdc-common-utils-ts/examples/shared';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { KmsService } from '../../../services/KmsService';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { getEnvSectionId } from '../../../utils/section-env';
import { verifyRegisteredIndividualMemberIdentity } from '../../../services/registered-individual-member-authority';
import { buildLocalClearingHouseVerifier } from '../../../bootstrap/build-clearing-house-verifier';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';
import { getTenantVaultId } from '../../../utils/tenant';
import { testClaimsTenant1Registration } from '../../data/end-to-end.data';
import { testConsentRulePermitOrgDid } from '../../data/consent-rules.data';
import { ClaimConsent, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { HealthcareBasicSections, HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { buildScopeSmartCompositionAccess } from 'gdc-common-utils-ts/utils/smart-scope';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { normalizeCodeSystemAndValue } from '../../../utils/normalize-codeAndSystem';
import { FederatedSmartVerificationManager } from '../../../managers/FederatedSmartVerificationManager';
import { ReplayProtectionStoreMem } from '../../../adapters/replay-protection-store';
import { EXAMPLE_RESEARCH_TENANT_IDENTIFIER, EXAMPLE_RESEARCH_API_ORGANIZATION_DID, EXAMPLE_GATEWAY_PUBLIC_ORIGIN } from 'gdc-common-utils-ts/examples/shared';
import { decodeJwt } from 'jose';
import { createHash } from 'node:crypto';

it.each([EXAMPLE_RELATED_PERSON_ROLE, EXAMPLE_RELATED_PERSON_INACTIVE_RELATIONSHIP])('issues and verifies personal index-to-EHR authorization for %s', async relationship => {
  const crypto = new CryptographyService(new AdapterCryptoSdkNode()); const vault = new VaultMemRepository(); let kms: KmsService;
  const tenants = new TenantsCacheManager(vault, () => kms, 'test-host-collection'); kms = new KmsService(crypto, tenants);
  const saved = { ...process.env }; process.env.SECURITY_MODE = 'strict'; process.env.NETWORK_MODE = 'test'; process.env.SMART_TOKEN_LEGACY = 'false';
  try {
    await kms.init(); const route = EXAMPLE_TENANT_ROUTE_CONTEXT; const vaultId = getTenantVaultId(route.sector, route.tenantId);
    await kms.provisionKeys(vaultId); const now = Math.floor(Date.now() / 1000);
    const delimiter = relationship.lastIndexOf('|');
    const actorDid = buildIndividualMemberDidWeb({ individualDidWeb: EXAMPLE_SUBJECT_DID, memberId: EXAMPLE_SECURE_ID_VALUE_INDIVIDUAL_CONTROLLER,
      roleType: relationship.slice(0, delimiter), roleValue: relationship.slice(delimiter + 1) });
    const tenantDid = getOrganizationDidFromIndividualDid(actorDid);
    const indexKey = await kms.getPublicVerificationKey(vaultId, undefined, 'comm_sig');
    const indexMethod = `${tenantDid}#${indexKey.kid}`;
    const registration = await kms.protectConfidentialData({ id: vaultId, status: 'active', sequence: 0, content: {
      id: vaultId, status: 'active', claims: { ...testClaimsTenant1Registration, [ClaimsOrganizationSchemaorg.alternateName]: route.tenantId },
      didDocument: { id: tenantDid, verificationMethod: [{ id: indexMethod, controller: tenantDid, type: 'JsonWebKey2020', publicKeyJwk: indexKey }], assertionMethod: [indexMethod] }, meta: { lastUpdated: new Date().toISOString() },
    } } as any, 'host');
    await vault.put('test-host-collection', [registration], getEnvSectionId('tenants')); await tenants.refreshTenant(vaultId);
    const walletVault = randomUUID(); await kms.provisionKeys(walletVault); const walletKey = await kms.getPublicVerificationKey(walletVault, undefined, 'comm_sig');
    const profile = { clientId: EXAMPLE_DEVICE_CLIENT_ID, actorDid, profileDid: actorDid, authorizedSubjectDid: EXAMPLE_SUBJECT_DID, jwks: { keys: [walletKey] },
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID, licenseId: randomUUID() };
    const licence = { id: profile.licenseId, userClass: 'individual', status: 'active', subjectId: profile.authenticatedSubject,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID, issuedToRole: relationship, issuedToEmail: EXAMPLE_CONTROLLER_EMAIL, exp: now + 300,
      deviceBindings: [{ clientId: profile.clientId, status: 'active' }] };
    const store = async (id: string, section: string, content: Record<string, unknown>) => {
      const encrypted = await kms.protectConfidentialData({ id, status: 'active', sequence: 0, content } as any, vaultId);
      await vault.put(vaultId, [encrypted], getEnvSectionId(section));
    };
    await store(profile.clientId, 'device-profiles', profile); await store(licence.id, 'device-licenses', licence);
    const credential = getIndividualMemberIdentityVC({ actorDid, subjectDid: EXAMPLE_SUBJECT_DID, relationship, email: EXAMPLE_CONTROLLER_EMAIL });
    const verify = (candidate = credential) => verifyRegisteredIndividualMemberIdentity({ credential: candidate, holder: profile.clientId,
      vaultId, kmsService: kms, vaultRepository: vault, now });
    await expect(verify()).resolves.toMatchObject({ actorDid, subjectDid: EXAMPLE_SUBJECT_DID, acr: 'urn:antifraud:acr:openid4vp:individual' });
    let clientAuth: OpenIdAuthManager;
    const native = buildLocalClearingHouseVerifier({ network: 'test', ledgerKind: 'memory', tenants, ledger: new CredentialLedgerAdapterMem(),
      kmsService: kms, vaultRepository: vault, cryptography: crypto, authorize: (request, identity) => clientAuth.verifyCurrentConsentContext(request, identity) });
    clientAuth = new OpenIdAuthManager(kms, tenants, vault, native, undefined, { cryptography: crypto });
    await expect((clientAuth as any).getActiveMemberLicense({ tenantVaultId: vaultId, subject: EXAMPLE_SUBJECT_DID,
      actorIdentifier: profile.authenticatedSubject, actorRole: relationship })).resolves.toMatchObject({ id: licence.id });
    const verifyWallet = async () => {
      const assertion = await kms.createCompactJws({ iss: profile.clientId, sub: profile.clientId, aud: tenantDid, iat: now, exp: now + 60, jti: randomUUID() }, walletKey.kid!, walletVault, 'comm_sig');
      const authenticated = await (clientAuth as any).validateClientAssertion({ clientId: profile.clientId, tenantVaultId: vaultId, issuerDid: tenantDid,
        body: { sub: actorDid, client_assertion_type: 'private_key_jwt', client_assertion: assertion } });
      const vpToken = await kms.createCompactJws({ iss: walletKey.kid, sub: actorDid,
        ...buildIndividualMemberIdentityVpPayload({ clientId: profile.clientId, actorDid, subjectDid: EXAMPLE_SUBJECT_DID, relationship, verifiableCredential: credential }) }, walletKey.kid!, walletVault, 'comm_sig');
      return native.verifyVpToken({ tenantDid, tenantVaultId: vaultId, holderVaultId: authenticated.registeredAtVaultId,
        authenticatedClientId: authenticated.clientId, tokenSubject: actorDid, vpToken, acrValues: ['urn:antifraud:acr:openid4vp:individual'] });
    };
    await expect(verifyWallet()).resolves.toMatchObject({ acr: 'urn:antifraud:acr:openid4vp:individual', trustChecks: { onChainChecked: false } });
    const allergy = HealthcareBasicSections.AllergiesAndIntolerances.attributeValue;
    const medication = HealthcareBasicSections.HistoryOfMedicationUse.attributeValue;
    const controller = relationship === EXAMPLE_RELATED_PERSON_ROLE;
    const consentId = randomUUID();
    const consent = { ...testConsentRulePermitOrgDid, id: consentId,
      [ClaimConsent.identifier]: `urn:uuid:${consentId}`, [ClaimConsent.subject]: EXAMPLE_SUBJECT_DID,
      [ClaimConsent.actorIdentifier]: actorDid, [ClaimConsent.actorRole]: relationship,
      [ClaimConsent.action]: allergy, [ClaimConsent.status]: ConsentStatuses.Active,
      [ClaimConsent.periodEnd]: new Date((now + 120) * 1000).toISOString(),
    } as any;
    if (!controller) await vault.put(vaultId, [consent], getIndividualSectionId(EXAMPLE_SUBJECT_DID, 'rules'));
    const mint = async (withoutPresentation = false) => {
      const assertion = await kms.createCompactJws({ iss: profile.clientId, sub: profile.clientId, aud: tenantDid, iat: now, exp: now + 60, jti: randomUUID() }, walletKey.kid!, walletVault, 'comm_sig');
      const vpToken = await kms.createCompactJws({ iss: walletKey.kid, sub: actorDid,
        ...buildIndividualMemberIdentityVpPayload({ clientId: profile.clientId, actorDid, subjectDid: EXAMPLE_SUBJECT_DID, relationship, verifiableCredential: credential }) }, walletKey.kid!, walletVault, 'comm_sig');
      return clientAuth.process({ tenantId: route.tenantId, jurisdiction: route.jurisdiction, sector: route.sector,
        section: 'identity', format: 'openid', resourceType: 'smart', action: 'token',
        content: { thid: randomUUID(), iss: profile.clientId, aud: tenantDid, body: {
          client_id: profile.clientId, client_assertion_type: 'private_key_jwt', client_assertion: assertion,
          sub: actorDid, vp_token: withoutPresentation ? undefined : vpToken, acr_values: 'urn:antifraud:acr:openid4vp:individual',
          purpose: HealthcareConsentPurposes.Treatment, expires_in: 60,
          scope: buildScopeSmartCompositionAccess({ subjectDid: EXAMPLE_SUBJECT_DID, sections: [allergy, medication] }),
        } },
      } as any);
    };
    const minted = await mint(); expect(minted.body.access_token).toBeTruthy();
    const granted = String(minted.body.scope).split(/\s+/).flatMap(scope => new URLSearchParams(scope.split('?')[1]).get('section')?.split(',') || []).map(normalizeCodeSystemAndValue);
    expect(new Set(granted)).toEqual(new Set((controller ? [allergy, medication] : [allergy]).map(normalizeCodeSystemAndValue)));
    if (controller) {
      expect((await mint(true)).body.access_token).toBeTruthy();
      await store(licence.id, 'device-licenses', { ...licence, status: 'inactive' });
      await expect(mint(true).then(() => 'allowed')).rejects.toThrow(/licen|inactive|authority/i);
      await store(licence.id, 'device-licenses', licence);
    } else {
      await expect(mint(true).then(() => 'allowed')).rejects.toThrow(/vp|controller|authority/i);
    }
    expect(await crypto.verifyJws(minted.body.access_token, indexKey)).toBe(true);
    const custodianId = EXAMPLE_RESEARCH_TENANT_IDENTIFIER;
    const custodianDid = EXAMPLE_RESEARCH_API_ORGANIZATION_DID;
    const custodianVault = getTenantVaultId(route.sector, custodianId); await kms.provisionKeys(custodianVault);
    const custodianRegistration = await kms.protectConfidentialData({ id: custodianVault, status: 'active', sequence: 0, content: {
      id: custodianVault, status: 'active', claims: { ...testClaimsTenant1Registration, [ClaimsOrganizationSchemaorg.alternateName]: custodianId },
      didDocument: { id: custodianDid }, meta: { lastUpdated: new Date().toISOString() },
    } } as any, 'host');
    await vault.put('test-host-collection', [custodianRegistration], getEnvSectionId('tenants')); await tenants.refreshTenant(custodianVault);
    const ehrWallet = randomUUID(); await kms.provisionKeys(ehrWallet); const ehrKey = await kms.getPublicVerificationKey(ehrWallet, undefined, 'comm_sig');
    const ehrClientId = randomUUID();
    const ehrProfile = await kms.protectConfidentialData({ id: ehrClientId, status: 'active', sequence: 0,
      content: { clientId: ehrClientId, jwks: { keys: [ehrKey] } } } as any, custodianVault);
    await vault.put(custodianVault, [ehrProfile], getEnvSectionId('device-profiles'));
    const ehrVerifier = new FederatedSmartVerificationManager({ tenantsManager: tenants, kmsService: kms, cryptography: crypto,
      vaultRepository: vault, clearingHouseService: native, replayProtectionStore: new ReplayProtectionStoreMem(),
      trustedIndexProviderIssuers: () => new Set([tenantDid]), resolveIssuerDidDocument: async () => (await tenants.getDidDocument(vaultId))!,
    });
    const requestUrl = `${EXAMPLE_GATEWAY_PUBLIC_ORIGIN}/${custodianId}/cds-${route.jurisdiction}/v1/${route.sector}/identity/openid/smart/token/_verify`;
    let lastRequestId: string;
    const verifyAtEhr = async (token = minted.body.access_token) => {
      lastRequestId = randomUUID();
      const clientAssertion = await kms.createCompactJws({ iss: ehrClientId, sub: ehrClientId, aud: requestUrl, iat: now, exp: now + 60, jti: lastRequestId }, ehrKey.kid!, ehrWallet, 'comm_sig', { jwk: ehrKey } as any);
      expect(await crypto.verifyJws(clientAssertion, ehrKey)).toBe(true);
      return ehrVerifier.verify({ tenantId: custodianId, jurisdiction: route.jurisdiction, sector: route.sector, token,
        clientAssertionType: 'private_key_jwt', clientAssertion, requestUrl });
    };
    const ehrResult = await verifyAtEhr(); expect(ehrResult.active).toBe(true);
    const custodianKey = await kms.getPublicVerificationKey(custodianVault, undefined, 'comm_sig');
    expect(await crypto.verifyJws(ehrResult.compactResponse, custodianKey)).toBe(true);
    expect(decodeJwt(ehrResult.compactResponse)).toMatchObject({ iss: custodianDid, aud: ehrClientId,
      token_introspection: { active: true, sub: actorDid, scope: minted.body.scope } });
    expect(decodeJwt(ehrResult.compactResponse).nonce).toBe(lastRequestId!);
    const originalClaims = decodeJwt(minted.body.access_token);
    const signedIndexOverride = (changes: Record<string, unknown>) => kms.createCompactJws({ ...originalClaims, ...changes, jti: randomUUID() }, indexKey.kid!, vaultId, 'comm_sig');
    const corruptSignature = (compact: string) => {
      const parts = compact.split('.'); const bytes = Buffer.from(parts[2], 'base64url'); bytes[0] ^= 1; parts[2] = bytes.toString('base64url'); return parts.join('.');
    };
    expect((await verifyAtEhr(corruptSignature(minted.body.access_token))).active).toBe(false);
    const invalidVp = corruptSignature(String(originalClaims.vp_token));
    expect((await verifyAtEhr(await signedIndexOverride({ vp_token: invalidVp, vp_hash: createHash('sha256').update(invalidVp).digest('hex') }))).active).toBe(false);
    expect((await verifyAtEhr(await signedIndexOverride({ scope: buildScopeSmartCompositionAccess({ subjectDid: EXAMPLE_SUBJECT_DID_SECONDARY, sections: [allergy] }) }))).active).toBe(false);
    if (!controller) {
      expect((await verifyAtEhr(await signedIndexOverride({ scope: buildScopeSmartCompositionAccess({ subjectDid: EXAMPLE_SUBJECT_DID, sections: [allergy, medication] }) }))).active).toBe(false);
      expect((await verifyAtEhr(await signedIndexOverride({ consent_ids: [] }))).active).toBe(false);
      await vault.put(vaultId, [{ ...consent, [ClaimConsent.status]: ConsentStatuses.Inactive }], getIndividualSectionId(EXAMPLE_SUBJECT_DID, 'rules'));
      expect((await verifyAtEhr()).active).toBe(false);
      await vault.put(vaultId, [consent], getIndividualSectionId(EXAMPLE_SUBJECT_DID, 'rules'));
      expect((await verifyAtEhr()).active).toBe(true);
    }
    await expect(verify(getIndividualMemberIdentityVC({ actorDid, subjectDid: EXAMPLE_SUBJECT_DID_SECONDARY, relationship }))).rejects.toThrow(/subject|individual/i);
    await store(licence.id, 'device-licenses', { ...licence, issuedToRole: 'ISCO-08|1120' }); await expect(verify()).rejects.toThrow(/role|relationship/i);
    await store(licence.id, 'device-licenses', { ...licence, status: 'inactive' }); await expect(verify()).rejects.toThrow(/inactive|licen/i);
    await store(licence.id, 'device-licenses', { ...licence, exp: now - 1 }); await expect(verify()).rejects.toThrow(/expir|licen/i);
    await store(licence.id, 'device-licenses', { ...licence, deviceBindings: [{ clientId: profile.clientId, status: 'revoked' }] }); await expect(verify()).rejects.toThrow(/device/i);
    await expect(verifyWallet()).rejects.toThrow(/device/i);
    await expect(mint()).rejects.toThrow(/device/i);
    expect((await verifyAtEhr()).active).toBe(false);
  } finally { kms.destroy(); process.env = saved; }
}, 30_000);
