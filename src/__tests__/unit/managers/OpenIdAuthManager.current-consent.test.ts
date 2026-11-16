// Flow contract: re-evaluate current consent from authoritative storage for the same professional, subject and scope; a previously valid token must fail after consent deactivation, expiry, denial or tenant suspension.
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { createHostedDidWeb } from '../../../utils/did-backend';
import { getTenantVaultId } from '../../../utils/tenant';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { EXAMPLE_HOST_PUBLIC_DID, EXAMPLE_TENANT_ROUTE_CONTEXT, EXAMPLE_PROFESSIONAL_DID, EXAMPLE_SUBJECT_DID } from 'gdc-common-utils-ts/examples/shared';
import { ClaimConsent, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { parseActorFromSub } from 'gdc-common-utils-ts/utils/actor';
import { buildScopeSmartCompositionAccess } from 'gdc-common-utils-ts/utils/smart-scope';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/healthcare';
import { testConsentRulePermitOrgDid } from '../../data/consent-rules.data';

describe('current consent verification', () => {
  async function fixture(overrides: Record<string, unknown> = {}, operational = true) {
    const route = EXAMPLE_TENANT_ROUTE_CONTEXT;
    const issuer = createHostedDidWeb(EXAMPLE_HOST_PUBLIC_DID, route.tenantId, { ...route, version: 'v1' });
    const vaultId = getTenantVaultId(route.sector, route.tenantId);
    const vault = new VaultMemRepository();
    const rule = { ...testConsentRulePermitOrgDid, [ClaimConsent.subject]: EXAMPLE_SUBJECT_DID,
      [ClaimConsent.actorIdentifier]: EXAMPLE_PROFESSIONAL_DID, [ClaimConsent.actorRole]: parseActorFromSub(EXAMPLE_PROFESSIONAL_DID).role, ...overrides };
    await vault.put(vaultId, [rule], getIndividualSectionId(EXAMPLE_SUBJECT_DID, 'rules'));
    const manager = new OpenIdAuthManager({} as any, { tenantExists: async () => true, isTenantOperational: async () => operational,
      getDidDocument: async () => ({ id: issuer }) } as any, vault, {} as any);
    const request = { vpToken: 'already-verified-by-caller', acrValues: [], tokenIssuer: issuer,
      tokenSubject: EXAMPLE_PROFESSIONAL_DID, tokenPurpose: testConsentRulePermitOrgDid[ClaimConsent.purpose],
      consentIdentifiers: [rule[ClaimConsent.identifier]], tokenScope: buildScopeSmartCompositionAccess({ subjectDid: EXAMPLE_SUBJECT_DID,
        sections: [HealthcareBasicSections.AllergiesAndIntolerances.attributeValue], accessVerb: 'rs' }) };
    return { manager, request };
  }
  it('accepts current active consent for the exact scope', async () => {
    const f = await fixture(); await expect(f.manager.verifyCurrentConsentContext(f.request)).resolves.toBeUndefined();
  });
  it.each([ConsentStatuses.Inactive, ConsentStatuses.Draft, ConsentStatuses.EnteredInError])('rejects current status %s', async status => {
    const f = await fixture({ [ClaimConsent.status]: status }); await expect(f.manager.verifyCurrentConsentContext(f.request)).rejects.toThrow();
  });
  it('rejects an expired consent', async () => {
    const f = await fixture({ [ClaimConsent.periodEnd]: new Date(Date.now() - 60_000).toISOString() }); await expect(f.manager.verifyCurrentConsentContext(f.request)).rejects.toThrow();
  });
  it('rejects current policy denial', async () => {
    const f = await fixture({ [ClaimConsent.decision]: 'deny' }); await expect(f.manager.verifyCurrentConsentContext(f.request)).rejects.toThrow();
  });
  it('rejects a suspended consent-owning tenant', async () => {
    const f = await fixture({}, false); await expect(f.manager.verifyCurrentConsentContext(f.request)).rejects.toThrow();
  });
});
