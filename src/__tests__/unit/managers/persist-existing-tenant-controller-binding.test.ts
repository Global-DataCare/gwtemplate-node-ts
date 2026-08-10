import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getEnvSectionId } from '../../../utils/section-env';
import { persistExistingTenantControllerBinding } from '../../../managers/hosting/persist-existing-tenant-controller-binding';

const CONTROLLER_DID = 'did:web:gateway.example.org:VATES-B00000000:cds-EU:v1:research:employee:controller';
const SIGNER_KID = 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:controller-comm';
const TENANT_VAULT_ID = 'onehealth-research_VATES-G02793479';

function publicKey(kid: string, alg: string) {
  return { kid, kty: alg.startsWith('ES') ? 'EC' : 'AKP', alg, use: 'sig', x: `${alg}-public-x` } as any;
}

describe('persistExistingTenantControllerBinding', () => {
  it('projects an ICA-approved multi-key controller onto an existing tenant', async () => {
    const tenantConfig = {
      id: TENANT_VAULT_ID,
      status: 'active',
      didDocument: { id: 'did:web:gateway.example.org:VATES-B00000000' },
      meta: { existing: true },
    };
    const tenantRegistrationDoc = { id: TENANT_VAULT_ID, status: 'active', sequence: 0, content: tenantConfig };
    const vaultRepository = {
      get: jest.fn(async () => tenantRegistrationDoc),
      put: jest.fn(async () => undefined),
    } as any;
    const kmsService = {
      protectConfidentialData: jest.fn(async (doc: unknown) => doc),
    } as any;
    const tenantsCacheManager = {
      getTenant: jest.fn(async () => tenantConfig),
      refreshTenant: jest.fn(async () => tenantConfig),
    } as any;
    const registerControllerKeysOnLedger = jest.fn(async (_input: unknown) => undefined);

    await persistExistingTenantControllerBinding({
      claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G02793479',
        [ClaimsServiceSchemaorg.category]: 'onehealth-research',
      },
      controller: {
        did: CONTROLLER_DID,
        publicKeyJwk: publicKey('registered-es384', 'ES384'),
        jwks: {
          keys: [
            publicKey('legacy-pontus-x', 'ES256K'),
            publicKey('controller-pqc', 'ML-DSA-65'),
            publicKey(SIGNER_KID, 'ML-DSA-44'),
          ],
        },
      },
      verifiedSignerKid: SIGNER_KID,
      transactionId: 'legal-organization-verification-thread-001',
      hostCollectionName: 'system_host',
      vaultRepository,
      kmsService,
      tenantsCacheManager,
      registerControllerKeysOnLedger,
    });

    const persisted = (vaultRepository.put as any).mock.calls[0][1][0].content;
    expect(persisted.didDocument.controller).toBe(CONTROLLER_DID);
    expect(persisted.meta.controllerDidDocument.verificationMethod).toHaveLength(4);
    expect(persisted.meta.controllerDidDocument.assertionMethod).toHaveLength(4);
    expect(vaultRepository.put).toHaveBeenCalledWith(
      'system_host',
      expect.any(Array),
      getEnvSectionId('tenants'),
    );
    expect(tenantsCacheManager.refreshTenant).toHaveBeenCalledWith(TENANT_VAULT_ID);
    expect(registerControllerKeysOnLedger).toHaveBeenCalledWith(expect.objectContaining({
      controllerDid: CONTROLLER_DID,
      transactionId: 'legal-organization-verification-thread-001',
      verificationMethods: expect.arrayContaining([
        expect.objectContaining({ publicKeyJwk: expect.objectContaining({ alg: 'ES256K' }) }),
        expect.objectContaining({ publicKeyJwk: expect.objectContaining({ alg: 'ML-DSA-65' }) }),
      ]),
    }));
  });

  it('rejects controller replacement when the verified signer is outside the submitted keyring', async () => {
    await expect(persistExistingTenantControllerBinding({
      claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G02793479',
        [ClaimsServiceSchemaorg.category]: 'onehealth-research',
      },
      controller: {
        did: CONTROLLER_DID,
        publicKeyJwk: publicKey('registered-es384', 'ES384'),
        jwks: { keys: [publicKey('controller-pqc', 'ML-DSA-65')] },
      },
      verifiedSignerKid: 'unrelated-signer',
      hostCollectionName: 'system_host',
      vaultRepository: {} as any,
      kmsService: {} as any,
      tenantsCacheManager: {} as any,
    })).rejects.toThrow('verified request signer must belong');
  });
});
