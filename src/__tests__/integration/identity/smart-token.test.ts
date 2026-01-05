// src/__tests__/integration/identity/smart-token.test.ts

import { invokeExpress } from '../helpers/invokeExpress';
import { getTenantVaultId } from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../../data/end-to-end.data';
import { testConsentRulePermitOrgDid } from '../../data/consent-rules.data';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { initializeTenantServicesConfig } from '../../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';

describe('SMART token issuance (integration)', () => {
  it('should issue token when subject exists and rules match', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';

    // Minimal host bootstrap config required by startServer().
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';

    jest.resetModules();
    const { startServer } = await import('../../../server');

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      // Create tenant "acme" directly in the host registry (avoid full crypto onboarding here).
      const hostBootstrapClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
        [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
        [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
        [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
      };
      const hostCollectionName = generateTenantCollectionNameFromClaims(hostBootstrapClaims);

      const tenantClaims = testPayloadCreateTenant1.body.data[0].meta.claims as any;
      const tenantVaultId = getTenantVaultId(
        tenantClaims[ClaimsServiceSchemaorg.category],
        tenantClaims['org.schema.Organization.alternateName'],
      );

      const tenantConfig = {
        claims: tenantClaims,
        didConfig: { service: initializeTenantServicesConfig(Sector.HEALTH_CARE) },
        didDocument: { id: 'did:web:api.acme.org', '@context': 'https://www.w3.org/ns/did/v1' },
      };

      // Ensure the tenant has signing keys available for token issuance.
      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], 'tenants');
      await tenantManager.getTenant(tenantVaultId);

      // Create the individual's physical vault and rules
      const subject = 'did:web:api.acme.org:individual:123';
      const individualVaultId = `acme/ES/health-care/individual/${subject}`;
      await vaultRepository.createNewVault({ id: individualVaultId } as any);
      await vaultRepository.put(individualVaultId, [{
        ...testConsentRulePermitOrgDid,
      } as any], 'rules');

      // Submit token request (legacy/plaintext)
      const tokenUrl = `/acme/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid: 'smart-token-thread-id',
          iss: 'did:web:api.acme.org:employee:admin1@acme.org:device:uuid',
          aud: 'did:web:api.acme.org',
          body: {
            sub: 'did:web:api.acme.org:employee:doctor1@acme.org:role:ISCO-08|2211',
            purpose: 'TREAT',
            scope: `patient/Composition.rs?subject=${subject}&section=LOINC|48765-2`,
            expires_in: 60,
          },
        },
      });
      expect(submitResp.status).toBe(202);

      // Poll for decrypted response
      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/acme/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toBe(subject);
    } finally {
      queueAdapter.stop();
    }
  });
});
