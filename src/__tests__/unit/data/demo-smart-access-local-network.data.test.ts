import {
  HealthcareActorRoles,
  HealthcareBasicSections,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/healthcare';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { summarizeInterTenantAccessContract } from 'gdc-common-utils-ts/utils/inter-tenant-access-contract';
import {
  DEMO_SMART_ACCESS_LOCAL_DIDS,
  DEMO_SMART_ACCESS_LOCAL_EMAILS,
  DEMO_SMART_ACCESS_LOCAL_IDS,
  buildDemoDigitalTwinCompositionSearchRequest,
  buildDemoIndividualIpsSearchRequest,
  buildDemoIndividualSmartTokenRequest,
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchSmartTokenRequest,
} from '../../data/demo-smart-access-local-network.data';

describe('demo smart access local-network builders', () => {
  const tenantId = 'acme-id';
  const subjectDid = `did:web:api.${tenantId}.org:individual:subject-001`;

  it('builds one individual smart token request rooted at organization/Composition.rs', async () => {
    const payload = await buildDemoIndividualSmartTokenRequest({ tenantId, subjectDid });

    expect(payload).toMatchObject({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualSmartThreadId,
      body: {
        purpose: HealthcareConsentPurposes.EmergencyTreatment,
        scope: `${ServiceCapability.IndexReader}?subject=${subjectDid}&section=${HealthcareBasicSections.PatientSummaryDocument.claim}`,
        client_assertion_type: 'private_key_jwt',
      },
    });
    expect(String((payload as any).body.client_assertion || '')).not.toHaveLength(0);
  });

  it('builds one individual IPS search request over Bundle/_search', () => {
    expect(buildDemoIndividualIpsSearchRequest({ subjectDid })).toEqual({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualBundleSearchThreadId,
      body: {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [
          {
            request: {
              method: 'GET',
              url:
                `Bundle?type=document&composition.subject=${encodeURIComponent(subjectDid)}`
                + `&composition.type=${encodeURIComponent(HealthcareBasicSections.PatientSummaryDocument.claim)}`,
            },
          },
        ],
      },
    });
  });

  it('builds one provider research permit by role rooted at ResearchSubject.rs', () => {
    expect(buildDemoResearchPermitByRoleConsent({ subjectDid })).toMatchObject({
      'Consent.subject': subjectDid,
      'Consent.actor-identifier': DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
      'Consent.actor-role': HealthcareActorRoles.Physician,
      'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      'Consent.action': ServiceCapability.DigitalTwinReader,
    });
  });

  it('builds one provider research permit by direct email rooted at ResearchSubject.rs', () => {
    expect(buildDemoResearchPermitByEmailConsent({ subjectDid })).toMatchObject({
      'Consent.subject': subjectDid,
      'Consent.actor-identifier': DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      'Consent.actor-role': HealthcareActorRoles.NursingProfessional,
      'Consent.purpose': EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      'Consent.action': ServiceCapability.DigitalTwinReader,
    });
  });

  it('builds one research requester matrix with allow and deny employee variants', () => {
    expect(buildDemoResearchRequesterMatrix()).toMatchObject({
      allowByRole: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
        actorRole: HealthcareActorRoles.Physician,
      },
      denyByRole: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
        actorRole: HealthcareActorRoles.NursingProfessional,
      },
      allowByEmail: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
        actorRole: HealthcareActorRoles.NursingProfessional,
      },
      denyByEmail: {
        actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
        actorRole: HealthcareActorRoles.NursingProfessional,
      },
    });
  });

  it('builds one research smart token request rooted at organization/ResearchSubject.rs', async () => {
    const matrix = buildDemoResearchRequesterMatrix();
    const providerOrganizationDid = 'did:web:localhost%3A3000:acme-id:cds-ES:v1:health-care';
    const payload = await buildDemoResearchSmartTokenRequest({
      tenantId,
      subjectDid,
      providerOrganizationDid,
      ...matrix.allowByRole,
    });

    expect(payload).toMatchObject({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleSmartThreadId,
      body: {
        purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
        scope: `${ServiceCapability.DigitalTwinReader}?subject=${encodeURIComponent(subjectDid)}`,
        sub: matrix.allowByRole.actorDid,
        client_assertion_type: 'client_assertion',
      },
    });
    expect(payload.aud).toBe(providerOrganizationDid);
    const vpToken = JSON.parse(String((payload as any).body.vp_token));
    expect(summarizeInterTenantAccessContract(vpToken.vp.verifiableCredential[0])).toMatchObject({
      providerOrganizationDid,
      consumerOrganizationDid: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
    });
    expect(String((payload as any).body.vp_token || '')).toContain('verifiableCredential');
  });

  it('builds one canonical digital-twin Composition search request for ibuprofen', () => {
    expect(buildDemoDigitalTwinCompositionSearchRequest()).toEqual({
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.digitalTwinSearchThreadId,
      body: {
        resourceType: 'Parameters',
        parameter: [
          { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
          { name: 'MedicationStatement.code-text', valueString: 'ibuprofen' },
        ],
      },
    });
  });
});
