// Flow contract: a registered EHR asks its own tenant to verify an index-provider token; the signed response preserves subject, purpose, scope and expiry, and requires current professional evidence.

import { createHash } from 'node:crypto';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { KmsService } from '../../../services/KmsService';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { buildClientAssertionFixture } from 'gdc-common-utils-ts/utils/client-assertion';
import { EXAMPLE_DEVICE_CLIENT_ID, EXAMPLE_SUBJECT_DID } from 'gdc-common-utils-ts/examples/shared';
import { buildScopeSmartCompositionAccess } from 'gdc-common-utils-ts/utils/smart-scope';
import { HealthcareBasicSections, HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { SmartIntrospectionExtensionFields } from 'gdc-common-utils-ts/utils/smart-authorization-profile';
import { buildDeterministicSignedJwt } from '../../utils/deterministic-jwt-fixtures';
import { FederatedSmartVerificationManager } from '../../../managers/FederatedSmartVerificationManager';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import type { ITenantsManager } from '../../../managers/ITenantsManager';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IClearingHouseService } from '../../../services/ClearingHouseService';
import { ReplayProtectionStoreMem } from '../../../adapters/replay-protection-store';

const INDEX_PROVIDER_DID = 'did:web:index.example';
const CUSTODIAN_TENANT_DID = 'did:web:custodian.example';
const PROFESSIONAL_DID = 'did:web:clinic.example:professional:doctor';
const ORIGINAL_PROFESSIONAL_CREDENTIAL = { type: ['VerifiableCredential'], credentialSubject: { id: PROFESSIONAL_DID } };
const PROFESSIONAL_PRESENTATION = [Buffer.from(JSON.stringify({ alg: 'ES384', typ: 'vp+jwt' })).toString('base64url'), Buffer.from(JSON.stringify({ vp: { type: ['VerifiablePresentation'], verifiableCredential: [ORIGINAL_PROFESSIONAL_CREDENTIAL] } })).toString('base64url'), 'unit-fixture-signature'].join('.');
const CONSENT_IDENTIFIER = 'urn:uuid:fedcba98-7654-4321-aaaa-0123456789ab';
const FIXED_NOW_SECONDS = 1_798_761_600;

function encodeKmsFixture(payload: Record<string, unknown>, header: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('FederatedSmartVerificationManager', () => {
  it('rejects a disabled custodian before resolving its client or signing a receipt', async () => {
    const getDidDocument = jest.fn(async () => ({ id: CUSTODIAN_TENANT_DID }));
    const manager = new FederatedSmartVerificationManager({
      tenantsManager: { tenantExists: async () => true, isTenantOperational: async () => false, getDidDocument } as any,
      kmsService: {} as any, vaultRepository: {} as any, clearingHouseService: {} as any,
      replayProtectionStore: new ReplayProtectionStoreMem(),
    });
    await expect(manager.verify({ tenantId: 'custodian', jurisdiction: 'ES', sector: 'health-care', token: 'index-token',
      clientAssertionType: 'private_key_jwt', clientAssertion: 'ehr-assertion', requestUrl: 'https://custodian.example/verify' })).rejects.toThrow(/inactive|disabled/i);
    expect(getDidDocument).not.toHaveBeenCalled();
  });
  it.each(['ES384', 'ML-DSA-44'])('authenticates the EHR and preserves authorization with a real %s index signature', async (algorithm) => {
    const verifyAudience = `${CUSTODIAN_TENANT_DID}/identity/openid/smart/token/_verify`;
    const clientAssertionFixture = await buildClientAssertionFixture({
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
      audience: verifyAudience,
      issuedAt: FIXED_NOW_SECONDS,
      expiresIn: FIXED_NOW_SECONDS + 300,
      nonce: 'federated-smart-client-assertion',
      additionalClaims: { jti: 'ehr-client-assertion-jti' },
    });
    const scope = buildScopeSmartCompositionAccess({
      subjectDid: EXAMPLE_SUBJECT_DID,
      sections: [HealthcareBasicSections.AllergiesAndIntolerances.attributeValue],
      accessVerb: 'rs',
    });
    const presentationHash = createHash('sha256').update(PROFESSIONAL_PRESENTATION, 'utf8').digest('hex');
    let foreignTokenFixture = await buildDeterministicSignedJwt({
      seed: 'federated-smart-index-provider',
      purpose: 'index-smart-token',
      payload: {
        iss: INDEX_PROVIDER_DID,
        aud: INDEX_PROVIDER_DID,
        sub: PROFESSIONAL_DID,
        scope,
        purpose: HealthcareConsentPurposes.Treatment,
        iat: FIXED_NOW_SECONDS,
        nbf: FIXED_NOW_SECONDS,
        exp: FIXED_NOW_SECONDS + 300,
        jti: 'index-smart-token-jti',
        vp_token: PROFESSIONAL_PRESENTATION,
        vp_hash: presentationHash,
        ledger_verified: true,
        consent_ids: [CONSENT_IDENTIFIER],
      },
    });


    const cryptography = new CryptographyService(new AdapterCryptoSdkNode());
    if (algorithm === 'ML-DSA-44') {
      let actualKms: KmsService;
      const tenants = new TenantsCacheManager(new VaultMemRepository(), () => actualKms, 'test-host-collection');
      actualKms = new KmsService(cryptography, tenants);
      try {
        await actualKms.init();
        await actualKms.provisionKeys('index-signing-fixture');
        const key = await actualKms.getPublicVerificationKey('index-signing-fixture', undefined, 'comm_sig');
        expect(key.alg).toBe('ML-DSA-44');
        const token = await actualKms.createCompactJws(foreignTokenFixture.payload, key.kid!, 'index-signing-fixture', 'comm_sig');
        foreignTokenFixture = { ...foreignTokenFixture, compactToken: token, publicJwk: key as any };
      } finally { actualKms.destroy(); }
    }

    const kmsService = {
      getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: `${CUSTODIAN_TENANT_DID}#comm-sig` }),
      unprotectConfidentialData: jest.fn().mockResolvedValue({
        clientId: EXAMPLE_DEVICE_CLIENT_ID,
        jwks: { keys: [clientAssertionFixture.publicJwk] },
      }),
      createCompactJws: jest.fn(async (payload: Record<string, unknown>, _kid: string, _vault: string, _purpose: string, header: Record<string, unknown>) =>
        encodeKmsFixture(payload, header)),
    } as unknown as jest.Mocked<IKmsService>;
    const tenantsManager = {
      tenantExists: jest.fn().mockResolvedValue(true),
      isTenantOperational: jest.fn().mockResolvedValue(true),
      getDidDocument: jest.fn().mockResolvedValue({ id: CUSTODIAN_TENANT_DID }),
    } as unknown as jest.Mocked<ITenantsManager>;
    const vaultRepository = {
      get: jest.fn().mockResolvedValue({ status: 'active', content: {} }),
    } as unknown as jest.Mocked<IVaultRepository>;
    const clearingHouseService = {
      verifyVpToken: jest.fn().mockResolvedValue({
        acr: 'urn:antifraud:acr:openid4vp:employee',
        amr: ['openid4vp', 'vc'],
        vpHash: presentationHash,
        ledgerVerified: true,
      }),
    } as jest.Mocked<IClearingHouseService>;

    const manager = new FederatedSmartVerificationManager({
      kmsService,
      ...{ cryptography },
      tenantsManager,
      vaultRepository,
      clearingHouseService,
      replayProtectionStore: new ReplayProtectionStoreMem(),
      now: () => FIXED_NOW_SECONDS,
      trustedIndexProviderIssuers: () => new Set([INDEX_PROVIDER_DID]),
      resolveIssuerDidDocument: jest.fn().mockResolvedValue({
        id: INDEX_PROVIDER_DID,
        verificationMethod: [{
          id: `${INDEX_PROVIDER_DID}#${foreignTokenFixture.publicJwk.kid}`,
          type: 'JsonWebKey2020',
          controller: INDEX_PROVIDER_DID,
          publicKeyJwk: foreignTokenFixture.publicJwk,
        }],
        assertionMethod: [`${INDEX_PROVIDER_DID}#${foreignTokenFixture.publicJwk.kid}`],
      }),
    });

    const result = await manager.verify({
      tenantId: 'custodian',
      jurisdiction: 'ES',
      sector: 'health-care',
      token: foreignTokenFixture.compactToken,
      tokenTypeHint: 'access_token',
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: clientAssertionFixture.jwt,
      requestUrl: verifyAudience,
    });

    expect(result.active).toBe(true);
    expect(decodeProtectedHeader(result.compactResponse).typ).toBe('token-introspection+jwt');
    const outer = decodeJwt(result.compactResponse) as any;
    expect(outer.iss).toBe(CUSTODIAN_TENANT_DID);
    expect(outer.aud).toBe(EXAMPLE_DEVICE_CLIENT_ID);
    expect(outer.token_introspection).toMatchObject({
      active: true,
      iss: INDEX_PROVIDER_DID,
      aud: INDEX_PROVIDER_DID,
      sub: PROFESSIONAL_DID,
      scope,
      purpose: HealthcareConsentPurposes.Treatment,
      exp: FIXED_NOW_SECONDS + 300,
      jti: 'index-smart-token-jti',
      consent_ids: [CONSENT_IDENTIFIER],

    });
    const verifiedPresentation = decodeJwt(outer.token_introspection[SmartIntrospectionExtensionFields.VpToken]) as any;
    expect(verifiedPresentation.vp.verifiableCredential).toEqual([ORIGINAL_PROFESSIONAL_CREDENTIAL]);
    expect(verifiedPresentation.iss).toBe(CUSTODIAN_TENANT_DID);
    expect(verifiedPresentation.aud).toBe(EXAMPLE_DEVICE_CLIENT_ID);
    expect(outer.token_introspection.exp).toBeLessThanOrEqual(FIXED_NOW_SECONDS + 300);
    expect(clearingHouseService.verifyVpToken).toHaveBeenCalledWith(expect.objectContaining({
      vpToken: PROFESSIONAL_PRESENTATION,
      tokenIssuer: INDEX_PROVIDER_DID,
      tokenSubject: PROFESSIONAL_DID,
      tokenScope: scope,
      consentIdentifiers: [CONSENT_IDENTIFIER],
    }));
  });
});
