import { startServer, resetServerConfig } from '../../../server';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import {
  RESEARCH_ACCESS_REQUESTER_MATRIX,
  RESEARCH_ACCESS_DEMO_MEDICATION_CASES,
  RESEARCH_ACCESS_SEARCH_FIXTURE,
  RESEARCH_ACCESS_TEST_IDS,
  TestResearchDigitalTwinSdk,
  TestResearchOrgControllerSdk,
} from '../helpers/research-access-sdk';

/**
 * Didactic end-to-end research access conversation.
 *
 * The flow intentionally reads like the future SDK choreography:
 * 1. an organization-controller facade prepares provider and consumer tenants
 * 2. the provider ingests one IPS for Doraemon and grants the consumer organization permit
 * 3. the provider ingests two medication-only fixtures for Novita
 * 3. the controller facade materializes the contract VC presentation
 * 4. a digital-twin facade asks GW for a SMART token with that proof
 * 5. the same digital-twin facade performs `Composition/_search` over the
 *    indexed document bundles for Doraemon and Novita and consumes the
 *    bundle-response payloads
 *
 * Internal smart-contract, queue, and policy plumbing stay inside GW.
 */
describe('Research access conversation (integration)', () => {
  afterEach(() => {
    resetServerConfig();
  });

  it('runs the orgControllerSdk-style and digitalTwinSdk-style flow end to end', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care,health-research';
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

    const gateway = await startServer({ listen: false });
    const organizationControllerSdk = new TestResearchOrgControllerSdk(gateway);
    const digitalTwinSdk = new TestResearchDigitalTwinSdk(gateway);

    try {
      await organizationControllerSdk.registerProviderTenant();
      await organizationControllerSdk.registerConsumerResearchTenant();
      await organizationControllerSdk.grantResearchPermitForSubject();

      const communicationPayload = await organizationControllerSdk.ingestProviderIpsFixture();
      expect(communicationPayload?.data?.[0]?.response?.status).toBe('200');
      const novitaIbuprofenPayload = await organizationControllerSdk.ingestNovitaMedicationFixture({
        thidComm: 'research-access-novita-ibuprofen-comm-001',
        thidMedSearch: 'research-access-novita-ibuprofen-med-search-001',
        thidIpsSearch: 'research-access-novita-ibuprofen-ips-search-001',
        medicationCaseIndex: RESEARCH_ACCESS_DEMO_MEDICATION_CASES.ibuprofen.caseIndex,
      });
      const novitaParacetamolPayload = await organizationControllerSdk.ingestNovitaMedicationFixture({
        thidComm: 'research-access-novita-paracetamol-comm-001',
        thidMedSearch: 'research-access-novita-paracetamol-med-search-001',
        thidIpsSearch: 'research-access-novita-paracetamol-ips-search-001',
        medicationCaseIndex: RESEARCH_ACCESS_DEMO_MEDICATION_CASES.paracetamol.caseIndex,
      });

      expect(novitaIbuprofenPayload?.data?.[0]?.response?.status).toBe('200');
      expect(novitaParacetamolPayload?.data?.[0]?.response?.status).toBe('200');

      const contractVpToken = organizationControllerSdk.buildResearchAccessContractVpToken();
      const smartTokenPayload = await digitalTwinSdk.requestResearchSmartAccessToken(contractVpToken);

      expect(smartTokenPayload?.access_token).toBeDefined();
      expect(smartTokenPayload?.subject).toBe(EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid);

      const compositionSearchPayload = await digitalTwinSdk.searchCompositionBundleByMedicationText(
        String(smartTokenPayload?.access_token || ''),
      );

      expect(compositionSearchPayload?.resourceType).toBe('Bundle');
      expect(compositionSearchPayload?.data?.[0]?.type).toBe('Composition-search-response-v1.0');
      expect(compositionSearchPayload?.data?.[0]?.resource?.total).toBeGreaterThanOrEqual(1);

      const firstMatch = compositionSearchPayload?.data?.[0]?.resource?.data?.[0];
      expect(
        firstMatch?.['Composition.subject']
        || firstMatch?.['org.hl7.fhir.r4.Composition.subject']
        || firstMatch?.meta?.claims?.['Composition.subject']
        || firstMatch?.meta?.claims?.['org.hl7.fhir.r4.Composition.subject'],
      ).toBe(EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid);
      expect(
        firstMatch?.['Composition.section']
        || firstMatch?.['org.hl7.fhir.r4.Composition.section']
        || firstMatch?.meta?.claims?.['Composition.section']
        || firstMatch?.meta?.claims?.['org.hl7.fhir.r4.Composition.section'],
      ).toBe(RESEARCH_ACCESS_SEARCH_FIXTURE.section);

      const novitaIbuprofenSearchPayload = await digitalTwinSdk.searchCompositionBundleByMedicationTextValue(
        String(smartTokenPayload?.access_token || ''),
        RESEARCH_ACCESS_DEMO_MEDICATION_CASES.ibuprofen.searchText,
      );
      const novitaParacetamolSearchPayload = await digitalTwinSdk.searchCompositionBundleByMedicationTextValue(
        String(smartTokenPayload?.access_token || ''),
        RESEARCH_ACCESS_DEMO_MEDICATION_CASES.paracetamol.searchText,
      );

      for (const payload of [novitaIbuprofenSearchPayload, novitaParacetamolSearchPayload]) {
        expect(payload?.resourceType).toBe('Bundle');
        expect(payload?.data?.[0]?.type).toBe('Composition-search-response-v1.0');
        expect(payload?.data?.[0]?.resource?.total).toBe(1);
        const onlyMatch = payload?.data?.[0]?.resource?.data?.[0];
        expect(
          onlyMatch?.['Composition.subject']
          || onlyMatch?.['org.hl7.fhir.r4.Composition.subject']
          || onlyMatch?.meta?.claims?.['Composition.subject']
          || onlyMatch?.meta?.claims?.['org.hl7.fhir.r4.Composition.subject'],
        ).toBe(RESEARCH_ACCESS_TEST_IDS.novitaSubjectDid);
      }

      await organizationControllerSdk.grantResearchPermitByRoleForSubjects([
        RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
      ]);
      const roleAllowedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.allowByRole,
      });
      expect(roleAllowedPayload?.access_token).toBeDefined();

      const roleDeniedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.denyByRole,
      });
      expect(roleDeniedPayload?.access_token).toBeUndefined();

      await organizationControllerSdk.grantResearchPermitByDirectEmailForSubjects([
        RESEARCH_ACCESS_TEST_IDS.emailOnlyPermitSubjectDid,
      ]);
      const emailAllowedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.emailOnlyPermitSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.allowByEmail,
      });
      expect(emailAllowedPayload?.access_token).toBeDefined();

      const emailDeniedPayload = await digitalTwinSdk.requestResearchSmartAccessTokenForRequester({
        subjectDid: RESEARCH_ACCESS_TEST_IDS.emailOnlyPermitSubjectDid,
        ...RESEARCH_ACCESS_REQUESTER_MATRIX.denyByEmail,
      });
      expect(emailDeniedPayload?.access_token).toBeUndefined();
    } finally {
      gateway.queueAdapter.stop();
    }
  });
});
