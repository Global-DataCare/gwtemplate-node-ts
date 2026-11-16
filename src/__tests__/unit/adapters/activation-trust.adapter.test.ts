// Flow contract: delegate activation verification to the receiving host, bind submitted credentials to the verified presentation, and preserve shared ICA controller policy.
import { describe, expect, it, jest } from '@jest/globals';
import {
  EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL,
  EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL,
  EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL,
  EXAMPLE_LEGAL_REPRESENTATIVE_ISCO_CODE,
  EXAMPLE_ORG_CONTROLLER_SIGNING_KEY_ID,
  EXAMPLE_REPRESENTATIVE_ROLE_CODE,
  cloneExample,
} from 'gdc-common-utils-ts';
import { DefaultActivationTrustAdapter } from '../../../adapters/activation-trust.adapter';
import { IClearingHouseService } from '../../../services/ClearingHouseService';
import { ITrustRegistryAdapter } from '../../../adapters/trust-registry.adapter';
import { buildDeterministicVpTokenFixture } from '../../utils/deterministic-jwt-fixtures';
import { deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';

const TEST_ORGANIZATION_DID = 'did:web:provider.example:health-care:organization:taxid:VATES-ESB00112233';
describe('DefaultActivationTrustAdapter', () => {
  const previousEnv = process.env;
  const vpTokenFor = (...credentials: any[]) => [
    Buffer.from(JSON.stringify({ alg: 'ML-DSA-44', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'did:web:controller.example.com', vp: { verifiableCredential: credentials.filter(Boolean) } })).toString('base64url'),
    'mock-signature',
  ].join('.');

  afterEach(() => {
    process.env = previousEnv;
  });

  it('routes activation to the receiving host rather than the unregistered organization', async () => {
    process.env = { ...previousEnv, SECURITY_MODE: 'strict', NETWORK_MODE: 'test' };
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;
    const vp = await buildDeterministicVpTokenFixture({ seed: 'activation-host-routing', issuerDid: TEST_ORGANIZATION_DID,
      audience: 'did:web:host.demo.example', credentials: [organizationCredential] });
    const verify = jest.fn(async () => ({ acr: 'urn:test:acr', ledgerVerified: false }));
    const registry: ITrustRegistryAdapter = { verifyActivationTrust: jest.fn(async () => ({ revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false })) };
    await new DefaultActivationTrustAdapter({ verifyVpToken: verify }, registry).evaluate({ networkMode: 'test', vpToken: vp.compactToken,
      primaryDid: TEST_ORGANIZATION_DID, organizationCredential, verifierTenantDid: 'did:web:host.demo.example' } as any);
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ tenantDid: 'did:web:host.demo.example', tenantVaultId: 'host' }));
  });

  it('rejects a body credential substituted after the presentation was signed', async () => {
    process.env = { ...previousEnv, SECURITY_MODE: 'strict', NETWORK_MODE: 'test' };
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;
    const vp = await buildDeterministicVpTokenFixture({ seed: 'activation-body-binding', issuerDid: TEST_ORGANIZATION_DID,
      audience: 'did:web:host.demo.example', credentials: [organizationCredential] });
    organizationCredential.credentialSubject.legalName = 'substituted';
    const adapter = new DefaultActivationTrustAdapter({ verifyVpToken: async () => ({ acr: 'urn:test:acr', ledgerVerified: true }) },
      { verifyActivationTrust: async () => ({ revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false }) });
    await expect(adapter.evaluate({ networkMode: 'test', vpToken: vp.compactToken, organizationCredential,
      verifierTenantDid: 'did:web:host.demo.example' } as any)).rejects.toThrow(/presentation|credential.*match/i);
  });

  it('rejects a different controller registration key after successful presentation verification', async () => {
    process.env = { ...previousEnv, SECURITY_MODE: 'strict', NETWORK_MODE: 'test' };
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;
    const vp = await buildDeterministicVpTokenFixture({ seed: 'activation-controller-binding', issuerDid: TEST_ORGANIZATION_DID,
      audience: 'did:web:host.demo.example', credentials: [organizationCredential] });
    const adapter = new DefaultActivationTrustAdapter({ verifyVpToken: async () => ({ acr: 'urn:test:acr', ledgerVerified: true }) },
      { verifyActivationTrust: async () => ({ revocationChecked: true, issuerKeyStatusChecked: true, subjectKeyStatusChecked: true, onChainChecked: false }) });
    await expect(adapter.evaluate({ networkMode: 'test', vpToken: vp.compactToken, organizationCredential,
      verifierTenantDid: 'did:web:host.demo.example', controllerBinding: { publicKeyJwk: deriveDeterministicEcJwkPair({ seed: 'other-controller', purpose: 'activation' }).publicJwk } } as any)).rejects.toThrow(/controller|signing key/i);
  });

  it('marks strict trust checks in test-network/network and delegates VP verification', async () => {
    const clearingHouseService: IClearingHouseService = {
      verifyVpToken: jest.fn(async () => ({
        acr: 'urn:test:acr',
        ledgerVerified: true,
      })),
    };
    const trustRegistryAdapter: ITrustRegistryAdapter = {
      verifyActivationTrust: jest.fn(async () => ({
        revocationChecked: true,
        issuerKeyStatusChecked: true,
        subjectKeyStatusChecked: true,
        onChainChecked: false,
      })),
    };
    const adapter = new DefaultActivationTrustAdapter(clearingHouseService, trustRegistryAdapter);
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;

    const representativeCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL);
    const controllerCredential = cloneExample(EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL);
    representativeCredential.credentialSubject.hasOccupation = {
      '@type': 'Occupation', identifier: { additionalType: 'ISCO-08', value: '1120' },
    };
    delete representativeCredential.credentialSubject.hasCredential;
    const result = await adapter.evaluate({
      networkMode: 'test-network',
      verifierTenantDid: 'did:web:host.demo.example',
      vpToken: vpTokenFor(organizationCredential, representativeCredential, controllerCredential),
      organizationCredential,
      representativeCredential,
      controllerCredential,
    });

    expect(result.organizationDid).toBe(TEST_ORGANIZATION_DID);
    expect(result.representativeDid).toBeUndefined();
    expect(result.clearingHouse.acr).toBe('urn:test:acr');
    expect(result.trustPolicy.networkMode).toBe('test-network');
    expect(result.trustPolicy.revocationChecked).toBe(true);
    expect(result.trustPolicy.onChainChecked).toBe(false);
    expect((trustRegistryAdapter.verifyActivationTrust as jest.Mock).mock.calls[0][0]).toMatchObject({
      networkMode: 'test-network',
      organizationDid: TEST_ORGANIZATION_DID,
    });
  });

  it('allows activation consistency evaluation without representative credential', async () => {
    const clearingHouseService: IClearingHouseService = {
      verifyVpToken: jest.fn(async () => ({
        acr: 'urn:test:acr',
        ledgerVerified: true,
      })),
    };
    const trustRegistryAdapter: ITrustRegistryAdapter = {
      verifyActivationTrust: jest.fn(async () => ({
        revocationChecked: true,
        issuerKeyStatusChecked: true,
        subjectKeyStatusChecked: true,
        onChainChecked: true,
      })),
    };
    const adapter = new DefaultActivationTrustAdapter(clearingHouseService, trustRegistryAdapter);
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;

    await expect(adapter.evaluate({
      networkMode: 'network',
      verifierTenantDid: 'did:web:host.demo.example',
      vpToken: vpTokenFor(organizationCredential),
      organizationCredential,
    })).resolves.toMatchObject({
      organizationDid: TEST_ORGANIZATION_DID,
      trustPolicy: { networkMode: 'network' },
    });
  });

  it('accepts only the old combined representative authority as a two-VC compatibility fallback', async () => {
    const clearingHouseService: IClearingHouseService = {
      verifyVpToken: jest.fn(async () => ({ acr: 'urn:test:acr', ledgerVerified: true })),
    };
    const trustRegistryAdapter: ITrustRegistryAdapter = {
      verifyActivationTrust: jest.fn(async () => ({
        revocationChecked: true,
        issuerKeyStatusChecked: true,
        subjectKeyStatusChecked: true,
        onChainChecked: false,
      })),
    };
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;
    const legacyRepresentative: any = cloneExample(EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL);
    legacyRepresentative.credentialSubject.hasOccupation = {
      identifier: { value: EXAMPLE_REPRESENTATIVE_ROLE_CODE },
    };
    legacyRepresentative.credentialSubject.hasCredential = {
      material: EXAMPLE_ORG_CONTROLLER_SIGNING_KEY_ID,
    };
    const adapter = new DefaultActivationTrustAdapter(clearingHouseService, trustRegistryAdapter);

    await expect(adapter.evaluate({
      networkMode: 'test-network',
      verifierTenantDid: 'did:web:host.demo.example',
      vpToken: vpTokenFor(organizationCredential, legacyRepresentative),
      organizationCredential,
      representativeCredential: legacyRepresentative,
    })).resolves.toMatchObject({ organizationDid: TEST_ORGANIZATION_DID });

    legacyRepresentative.credentialSubject.hasOccupation = {
      '@type': 'Occupation',
      identifier: { additionalType: 'ISCO-08', value: EXAMPLE_LEGAL_REPRESENTATIVE_ISCO_CODE },
    };
    await expect(adapter.evaluate({
      networkMode: 'test-network',
      verifierTenantDid: 'did:web:host.demo.example',
      vpToken: vpTokenFor(organizationCredential, legacyRepresentative),
      organizationCredential,
      representativeCredential: legacyRepresentative,
    })).rejects.toThrow('controller role RESPRSN in credentialSubject.hasOccupation');
  });

  it('verifies one deterministically signed ES384 vp_token in strict mode when the controller JWK is embedded', async () => {
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'strict',
      NODE_ENV: 'test',
    };

    const clearingHouseService: IClearingHouseService = {
      verifyVpToken: jest.fn(async () => ({
        acr: 'urn:test:acr',
        ledgerVerified: true,
      })),
    };
    const trustRegistryAdapter: ITrustRegistryAdapter = {
      verifyActivationTrust: jest.fn(async () => ({
        revocationChecked: true,
        issuerKeyStatusChecked: true,
        subjectKeyStatusChecked: true,
        onChainChecked: false,
      })),
    };
    const organizationCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_ORGANIZATION_CREDENTIAL);
    organizationCredential.credentialSubject.id = TEST_ORGANIZATION_DID;
    const representativeCredential: any = cloneExample(EXAMPLE_ORG_ACTIVATION_LEGAL_REPRESENTATIVE_CREDENTIAL);
    const controllerCredential = cloneExample(EXAMPLE_ORG_ACTIVATION_CONTROLLER_CREDENTIAL);
    const vpFixture = await buildDeterministicVpTokenFixture({
      seed: 'gw-activation-trust-seed-001',
      issuerDid: 'did:web:controller.demo.example',
      audience: 'did:web:host.demo.example',
      credentials: [
        organizationCredential,
        representativeCredential,
        controllerCredential,
      ],
    });
    const adapter = new DefaultActivationTrustAdapter(clearingHouseService, trustRegistryAdapter);

    await expect(adapter.evaluate({
      networkMode: 'test-network',
      vpToken: vpFixture.compactToken,
      verifierTenantDid: 'did:web:host.demo.example',
      organizationCredential,
      representativeCredential,
      controllerCredential,
    })).resolves.toMatchObject({
      organizationDid: TEST_ORGANIZATION_DID,
      trustPolicy: { networkMode: 'test-network' },
    });
  });
});
