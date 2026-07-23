// src/__tests__/integration/identity/smart-token.test.ts

import { invokeExpress } from '../helpers/invokeExpress';
import { getTenantVaultId } from '../../../utils/tenant';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { testPayloadCreateTenant1 } from '../../data/end-to-end.data';
import { testConsentRulePermitOrgDid } from '../../data/consent-rules.data';
import { generateTenantCollectionNameFromClaims } from '../../../utils/tenant';
import { initializeTenantServicesConfig } from '../../../utils/services';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { startServer, resetServerConfig } from '../../../server';
import { getEnvSectionId } from '../../../utils/section-env';
import { testTenant1AlternateName, testTenant1VaultId } from '../../data/organization.data';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { buildClientAssertionJwt } from 'gdc-common-utils-ts/utils/client-assertion';
import { addVC, createVP } from 'gdc-common-utils-ts/utils/vp-token';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions } from 'gdc-common-utils-ts/models/consent-rule';
import {
  EXAMPLE_HOSTING_OPERATOR_DID,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';

const EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE =
  `${ServiceCapability.DigitalTwinReader}?subject=${EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid}`;

/**
 * Reuses the shared research contract while specializing its capability for
 * the DigitalTwin/ResearchSubject boundary enforced by the live route.
 */
function buildExampleInterTenantDigitalTwinContractCredential(): Record<string, unknown> {
  const credential = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CREDENTIAL as any;
  return {
    ...credential,
    credentialSubject: {
      ...(credential.credentialSubject || {}),
      term: (credential.credentialSubject?.term || []).map((term: any) => ({
        ...term,
        offer: {
          ...(term.offer || {}),
          securityLabel: [{ text: ServiceCapability.DigitalTwinReader }],
        },
      })),
    },
  };
}

describe('SMART token issuance (integration)', () => {
  it('should issue an individual self-read token when the subject DID uses a public provider root', async () => {
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
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

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
        didDocument: { id: EXAMPLE_HOSTING_OPERATOR_DID, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      // Ensure the tenant has signing keys available for token issuance.
      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      // Create the individual's physical vault and rules
      const subject = EXAMPLE_SUBJECT_DID;
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        id: 'individual-self-read-integration',
        '@context': 'org.hl7.fhir.api',
        [ClaimConsent.subject]: subject,
        [ClaimConsent.identifier]: 'urn:uuid:individual-self-read-integration',
        [ClaimConsent.decision]: ConsentDecisions.Permit,
        [ClaimConsent.actorIdentifier]: subject,
        [ClaimConsent.action]: `${ServiceCapability.IndexReader}?section=*`,
        [ClaimConsent.purpose]: HealthcareConsentPurposes.Treatment,
      } as any], individualRulesSectionId);

      const clientId = `${subject}:device:client-001`;
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_HOSTING_OPERATOR_DID,
      });
      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid: 'smart-token-thread-id',
          iss: clientId,
          aud: EXAMPLE_HOSTING_OPERATOR_DID,
        body: {
          client_id: clientId,
          client_assertion: clientAssertion,
          client_assertion_type: 'private_key_jwt',
          sub: subject,
          purpose: HealthcareConsentPurposes.Treatment,
          scope: `${ServiceCapability.IndexReader}?subject=${subject}&section=*`,
          expires_in: 60,
          vp_token: '---VP---',
          acr_values: 'urn:antifraud:acr:openid4vp:individual',
        },
      },
    });
      expect([202, 415]).toContain(submitResp.status);
      if (submitResp.status !== 202) return;

      // Poll for decrypted response
      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
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

  it('should issue token for a foreign tenant actor only when a matching inter-tenant contract VC is presented', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
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
        didDocument: { id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subject = 'did:web:api.acme.org:individual:123';
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        ...testConsentRulePermitOrgDid,
        'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
        'Consent.action': `${ServiceCapability.DigitalTwinReader}?subject=*`,
      } as any], individualRulesSectionId);

      // Research internal profile:
      // - `client_assertion` authenticates the researcher's registered client
      // - `vp_token` carries the inter-tenant contract VC inside the VP
      const vpPayload = createVP({
        iss: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
      });
      addVC(vpPayload, buildExampleInterTenantDigitalTwinContractCredential());
      const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-002';
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      });

      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: 'Bearer mock' },
        body: {
          thid: 'smart-token-inter-tenant-thread-id',
          iss: clientId,
          aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          body: {
            client_id: clientId,
            client_assertion: clientAssertion,
            client_assertion_type: 'client_assertion',
            sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
            purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
            scope: EXAMPLE_INTER_TENANT_DIGITAL_TWIN_SCOPE,
            expires_in: 60,
            vp_token: JSON.stringify(vpPayload),
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
          },
        },
      });
      expect([202, 415]).toContain(submitResp.status);
      if (submitResp.status !== 202) return;

      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-inter-tenant-thread-id' },
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

  it('should issue token for research access with one trusted external bearer instead of vp_token', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'false';
    process.env.AUTH_TOKEN_VERIFIER = 'demo';
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
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
        didDocument: { id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subject = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid;
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        ...testConsentRulePermitOrgDid,
        'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        'Consent.purpose': 'RESEARCH',
      } as any], individualRulesSectionId);

      // Research external profile:
      // - `client_assertion` still proves possession of the client private key
      // - external bearer replaces only the internal contract-via-`vp_token`
      const bearerPayload = {
        iss: 'https://pontus-x.example',
        aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
        consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        purpose: 'RESEARCH',
        scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
      };
      const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-003';
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      });
      const bearerToken = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(bearerPayload)).toString('base64url'),
        'demo',
      ].join('.');

      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearerToken}` },
        body: {
          thid: 'smart-token-external-research-thread-id',
          iss: clientId,
          aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          body: {
            client_id: clientId,
            client_assertion: clientAssertion,
            client_assertion_type: 'private_key_jwt',
            sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
            purpose: 'RESEARCH',
            scope: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_SMART_SCOPE,
            expires_in: 60,
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
          },
        },
      });
      expect([202, 415]).toContain(submitResp.status);
      if (submitResp.status !== 202) return;

      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-external-research-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toBe(subject);
      expect(finalPayload?.ledger_verified).toBe(true);
    } finally {
      queueAdapter.stop();
    }
  });

  it('should issue token for research access with one trusted external bearer and canonical ResearchSubject action', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';
    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.SECURITY_MODE = 'demo';
    process.env.JSON_LEGACY = 'true';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'false';
    process.env.AUTH_TOKEN_VERIFIER = 'demo';
    process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS = 'https://pontus-x.example';

    resetServerConfig();

    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
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
        didDocument: { id: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid, '@context': 'https://www.w3.org/ns/did/v1' },
      };

      await kmsService.provisionKeys(tenantVaultId);

      const secureTenantRecord = await kmsService.protectConfidentialData(
        { id: tenantVaultId, sequence: 0, content: tenantConfig } as any,
        'host',
      );
      await vaultRepository.put(hostCollectionName, [secureTenantRecord as any], getEnvSectionId('tenants'));
      await tenantManager.getTenant(tenantVaultId);

      const subject = EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid;
      const individualRulesSectionId = getIndividualSectionId(subject, 'rules');
      await vaultRepository.put(tenantVaultId, [{
        ...testConsentRulePermitOrgDid,
        'Consent.actor-identifier': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        'Consent.purpose': 'RESEARCH',
        'Consent.action': 'ResearchSubject.rs',
      } as any], individualRulesSectionId);

      const researchSubjectScope = `organization/ResearchSubject.rs?subject=${subject}`;
      const bearerPayload = {
        iss: 'https://pontus-x.example',
        aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
        consumerOrganizationDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
        purpose: 'RESEARCH',
        scope: researchSubjectScope,
      };
      const clientId = 'did:web:lab.example:employee:researcher1@lab.org:device:client-004';
      const clientAssertion = await buildClientAssertionJwt({
        clientId,
        audience: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      });
      const bearerToken = [
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify(bearerPayload)).toString('base64url'),
        'demo',
      ].join('.');

      const tokenUrl = `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`;
      const submitResp = await invokeExpress(app, {
        method: 'POST',
        url: tokenUrl,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${bearerToken}` },
        body: {
          thid: 'smart-token-external-research-rs-thread-id',
          iss: clientId,
          aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          body: {
            client_id: clientId,
            client_assertion: clientAssertion,
            client_assertion_type: 'private_key_jwt',
            sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
            purpose: 'RESEARCH',
            scope: researchSubjectScope,
            expires_in: 60,
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
          },
        },
      });
      expect([202, 415]).toContain(submitResp.status);
      if (submitResp.status !== 202) return;

      let finalPayload: any;
      for (let i = 0; i < 50; i++) {
        const pollResp = await invokeExpress(app, {
          method: 'POST',
          url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
          headers: { 'content-type': 'application/json' },
          body: { thid: 'smart-token-external-research-rs-thread-id' },
        });
        if (pollResp.status === 200) {
          finalPayload = JSON.parse(pollResp.text);
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(finalPayload?.access_token).toBeDefined();
      expect(finalPayload?.subject).toBe(subject);
      expect(finalPayload?.ledger_verified).toBe(true);
    } finally {
      queueAdapter.stop();
    }
  });
});
