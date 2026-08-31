// TDD contract: write this test red first; make it green only with the complete real behavior.
// TDD contract: research fixtures distinguish authenticated local authors from preserved external IPS provenance.
import { readFileSync } from 'fs';
import path from 'path';
import { HealthcareBasicSections } from 'gdc-common-utils-ts/constants/index';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimConsent, ConsentDecisions } from 'gdc-common-utils-ts/models/consent-rule';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import {
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT,
  EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
} from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import {
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchContractVpToken,
  buildDemoResearchSmartTokenRequest,
} from '../../data/demo-smart-access-local-network.data';
import { initializeTenantServicesConfig } from '../../../utils/services';
import { getIndividualSectionId } from '../../../utils/individual-sections';
import { getEnvSectionId } from '../../../utils/section-env';
import { persistConsentRuleAndAttachment } from '../../../utils/consent-storage';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../../utils/tenant';
import { invokeExpress } from './invokeExpress';
import { testPayloadCreateTenant1 } from '../../data/end-to-end.data';
import {
  buildDemoCommunicationBatchSubmitRequest,
  demoCommunicationMedicationIpsDefaults,
} from '../../data/demo-communication-medications-ips.data';
import { testTenant1AlternateName } from '../../data/organization.data';

/**
 * Shared opaque ids used by the didactic research-access integration flow.
 *
 * Keeping these values together avoids inline literals inside the conversation
 * test and makes the high-level steps easier to read.
 */
export const RESEARCH_ACCESS_TEST_IDS = Object.freeze({
  providerTenantRegistration: 'research-access-provider-tenant-001',
  consumerTenantRegistration: 'research-access-consumer-tenant-001',
  subjectPermitRule: 'research-access-subject-permit-001',
  communicationThreadId: 'research-access-communication-001',
  smartTokenThreadId: 'research-access-smart-token-001',
  compositionSearchThreadId: 'research-access-composition-search-001',
  documentReferenceId: 'research-access-document-reference-001',
  documentReferenceIdentifier: 'urn:uuid:research-access-document-reference-001',
  deviceDid: 'did:web:device.lab.example',
  doraemonSubjectDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.subjectDid,
  novitaSubjectDid: 'did:web:api.acme.org:individual:novita',
  emailOnlyPermitSubjectDid: 'did:web:api.acme.org:individual:email-only',
});

/**
 * Search fixture consumed by the digital-twin search facade.
 *
 * The section and coded medication are deliberately aligned with the IPS all-sections
 * fixture already proven in the composition search integration suite.
 */
export const RESEARCH_ACCESS_SEARCH_FIXTURE = Object.freeze({
  section: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue,
  medicationCode: 'http://snomed.info/sct|108575001',
  codeClaim: 'MedicationStatement.code',
});

/**
 * Canonical demo medication search cases reused by the research-access
 * conversation test.
 */
export const RESEARCH_ACCESS_DEMO_MEDICATION_CASES = Object.freeze({
  ibuprofen: Object.freeze({
    caseIndex: 0,
    searchCode: demoCommunicationMedicationIpsDefaults.demoMedicationCases[0].demoMedicationCode,
  }),
  paracetamol: Object.freeze({
    caseIndex: 1,
    searchCode: demoCommunicationMedicationIpsDefaults.demoMedicationCases[1].demoMedicationCode,
  }),
});

export const RESEARCH_ACCESS_REQUESTER_MATRIX = Object.freeze(buildDemoResearchRequesterMatrix());

/**
 * Minimal runtime dependencies from `startServer()` that the high-level test
 * facades need in order to orchestrate GW in memory.
 */
export type ResearchAccessGatewayDeps = {
  app: any;
  tenantManager: any;
  vaultRepository: any;
  kmsService: any;
};

/**
 * Polls a GW accepted operation until the batch/token response becomes
 * available.
 */
export async function pollAcceptedGatewayOperation(input: {
  app: any;
  url: string;
  thid: string;
}): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pollResp = await invokeExpress(input.app, {
      method: 'POST',
      url: input.url,
      headers: { 'content-type': 'application/json' },
      body: { thid: input.thid },
    });
    if (pollResp.status === 200) {
      return JSON.parse(pollResp.text);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

/**
 * Loads the official HL7 IPS all-sections fixture and rewrites the patient
 * references to the requested research subject DID.
 */
export function loadResearchIpsAllSectionsFixture(subjectDid: string): any {
  const fixturePath = path.join(process.cwd(), 'node_modules', 'gdc-common-utils-ts', 'fixtures', 'fhir-ips-bundle-all-sections.json');
  const bundle = JSON.parse(readFileSync(fixturePath, 'utf8'));
  for (const entry of Array.isArray(bundle?.entry) ? bundle.entry : []) {
    const resource = entry?.resource;
    if (!resource || typeof resource !== 'object') continue;

    if (resource.resourceType === 'Composition') {
      resource.author = [{ reference: demoCommunicationMedicationIpsDefaults.externalAuthorUrn }];
    }

    if (resource?.subject?.reference) {
      resource.subject.reference = subjectDid;
    }
    if (resource?.patient?.reference) {
      resource.patient.reference = subjectDid;
    }
    if (resource?.medicationCodeableConcept?.coding?.[0]) {
      resource.medicationCodeableConcept.coding[0].userSelected = true;
      resource.medicationCodeableConcept.text ||= resource.medicationCodeableConcept.coding[0].display;
    }
    if (resource?.code?.coding?.[0]) {
      resource.code.coding[0].userSelected = true;
      resource.code.text ||= resource.code.coding[0].display;
    }
    if (resource?.vaccineCode?.coding?.[0]) {
      resource.vaccineCode.coding[0].userSelected = true;
      resource.vaccineCode.text ||= resource.vaccineCode.coding[0].display;
    }
    if (resource?.category?.[0]?.coding?.[0]) {
      resource.category[0].coding[0].userSelected = true;
      resource.category[0].text ||= resource.category[0].coding[0].display;
    }
  }
  return bundle;
}

function buildLabTenantClaims(): Record<string, unknown> {
  const baseClaims = {
    ...(testPayloadCreateTenant1.body.data[0].meta.claims as Record<string, unknown>),
  };
  return {
    ...baseClaims,
    [ClaimsOrganizationSchemaorg.legalName]: 'Lab Research Org SL',
    [ClaimsOrganizationSchemaorg.name]: 'Lab Research Org',
    [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerTenantId,
    [ClaimsOrganizationSchemaorg.identifierValue]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerTenantId,
    [ClaimsOrganizationSchemaorg.url]: 'api.lab.org',
    [ClaimsServiceSchemaorg.category]: 'health-research',
  };
}

function buildHostCollectionName(): string {
  return generateTenantCollectionNameFromClaims({
    [ClaimsOrganizationSchemaorg.addressCountry]: process.env.ORG_HOST_JURISDICTION,
    [ClaimsOrganizationSchemaorg.identifierType]: process.env.ORG_HOST_ID_TYPE,
    [ClaimsOrganizationSchemaorg.identifierValue]: process.env.ORG_HOST_ID_VALUE,
    [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
  });
}

/**
 * Test-only facade that mirrors the high-level responsibilities expected from
 * an organization-controller SDK:
 * - bootstrap provider/consumer hosted tenants
 * - ingest provider subject data
 * - define the subject-side permit rule
 * - materialize the inter-tenant contract proof presented later to SMART
 *
 * Smart-contract persistence, ledger anchoring, and other internal plumbing
 * still belong to GW. The facade only drives the externally visible flow.
 */
export class TestResearchOrgControllerSdk {
  constructor(
    private readonly deps: ResearchAccessGatewayDeps,
    private readonly authorizationHeader: string,
  ) {}

  /**
   * Registers the provider tenant (`acme`) directly in the in-memory host
   * registry used by the integration suite.
   */
  public async registerProviderTenant(): Promise<void> {
    const providerClaims = testPayloadCreateTenant1.body.data[0].meta.claims as Record<string, unknown>;
    await this.registerHostedTenant({
      claims: providerClaims,
      didDocumentId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
      sector: Sector.HEALTH_CARE,
    });
  }

  /**
   * Registers the consumer tenant (`lab`) directly in the in-memory host
   * registry used by the integration suite.
   */
  public async registerConsumerResearchTenant(): Promise<void> {
    await this.registerHostedTenant({
      claims: buildLabTenantClaims(),
      didDocumentId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
      sector: 'health-research' as Sector,
    });
  }

  /**
   * Seeds the provider-side subject access rule that allows the foreign
   * research organization to request a SMART token for the configured section.
   */
  public async grantResearchPermitForSubject(): Promise<void> {
    await this.grantResearchPermitForSubjects([
      RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
      RESEARCH_ACCESS_TEST_IDS.novitaSubjectDid,
    ]);
  }

  /**
   * Seeds provider-side permit rules for the requested subjects so the foreign
   * research organization can request access over each digital twin.
   */
  public async grantResearchPermitForSubjects(subjectDids: readonly string[]): Promise<void> {
    const providerVaultId = getTenantVaultId(
      String(Sector.HEALTH_CARE),
      EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
    );
    await Promise.all(subjectDids.map(async (subjectDid, index) => {
      await persistConsentRuleAndAttachment({
        vaultRepository: this.deps.vaultRepository,
        tenantVaultId: providerVaultId,
        sector: String(Sector.HEALTH_CARE),
        claims: {
          '@context': 'org.hl7.fhir.api',
          [ClaimConsent.subject]: subjectDid,
          [ClaimConsent.actorIdentifier]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
          [ClaimConsent.actorRole]: 'provider',
          [ClaimConsent.decision]: ConsentDecisions.Permit,
          [ClaimConsent.purpose]: 'RESEARCH',
          [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
          [ClaimConsent.date]: '2026-06-29',
          [ClaimConsent.sourceReference]: `https://portal.example/secondary-use/${index + 1}`,
        },
      });
      await this.deps.vaultRepository.put(
        providerVaultId,
        [{
          id: `${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-${index + 1}`,
          '@context': 'org.hl7.fhir.api',
          [ClaimConsent.identifier]: `urn:uuid:${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-${index + 1}`,
          [ClaimConsent.subject]: subjectDid,
          [ClaimConsent.actorIdentifier]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.consumerOrganizationDid,
          [ClaimConsent.actorRole]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.actorRole,
          [ClaimConsent.decision]: ConsentDecisions.Permit,
          [ClaimConsent.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          [ClaimConsent.action]: `${ServiceCapability.DigitalTwinReader}?subject=*`,
          [ClaimConsent.date]: '2026-06-29',
        }],
        getIndividualSectionId(subjectDid, 'rules'),
      );
    }));
  }

  /**
   * Seeds provider-side permit rules whose role constraint is evaluated against
   * the requester employee.
   */
  public async grantResearchPermitByRoleForSubjects(subjectDids: readonly string[]): Promise<void> {
    const providerVaultId = getTenantVaultId(
      String(Sector.HEALTH_CARE),
      EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
    );
    await Promise.all(subjectDids.map(async (subjectDid, index) => {
      await this.deps.vaultRepository.put(
        providerVaultId,
        [{
          ...buildDemoResearchPermitByRoleConsent({ subjectDid }),
          id: `${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-role-${index + 1}`,
          [ClaimConsent.identifier]: `urn:uuid:${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-role-${index + 1}`,
        }],
        getIndividualSectionId(subjectDid, 'rules'),
      );
    }));
  }

  /**
   * Seeds provider-side permit rules that directly target one allowed research
   * employee email.
   */
  public async grantResearchPermitByDirectEmailForSubjects(subjectDids: readonly string[]): Promise<void> {
    const providerVaultId = getTenantVaultId(
      String(Sector.HEALTH_CARE),
      EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
    );
    await Promise.all(subjectDids.map(async (subjectDid, index) => {
      await this.deps.vaultRepository.put(
        providerVaultId,
        [{
          ...buildDemoResearchPermitByEmailConsent({ subjectDid }),
          id: `${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-email-${index + 1}`,
          [ClaimConsent.identifier]: `urn:uuid:${RESEARCH_ACCESS_TEST_IDS.subjectPermitRule}-email-${index + 1}`,
        }],
        getIndividualSectionId(subjectDid, 'rules'),
      );
    }));
  }

  /**
   * Ingests the shared IPS fixture through the same Communication flow used by
   * the rest of GW integration coverage so the digital-twin projections are
   * created by real backend processing.
   */
  public async ingestProviderIpsFixture(): Promise<any> {
    const ipsBundle = loadResearchIpsAllSectionsFixture(RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid);
    const documentReference = {
      resourceType: 'DocumentReference',
      id: RESEARCH_ACCESS_TEST_IDS.documentReferenceId,
      subject: { reference: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid },
      date: '2026-06-29T10:00:00Z',
      description: 'Research access IPS fixture',
      identifier: [{ system: 'urn:ietf:rfc:3986', value: RESEARCH_ACCESS_TEST_IDS.documentReferenceIdentifier }],
      content: [
        {
          attachment: {
            contentType: 'application/fhir+json',
            title: 'bundle-ips-all-sections.json',
            data: Buffer.from(JSON.stringify(ipsBundle), 'utf8').toString('base64'),
          },
        },
      ],
    };

    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: {
        thid: RESEARCH_ACCESS_TEST_IDS.communicationThreadId,
        body: {
          resourceType: 'Bundle',
          type: 'batch',
          entry: [
            {
              request: { method: 'POST', url: 'individual/org.hl7.fhir.r4/Communication' },
              resource: {
                resourceType: 'Communication',
                status: 'completed',
                subject: { reference: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid },
                sent: '2026-06-29T10:00:00Z',
                payload: [
                  {
                    contentAttachment: {
                      contentType: 'application/fhir+json',
                      title: 'ips-document-reference.json',
                      data: Buffer.from(JSON.stringify(documentReference), 'utf8').toString('base64'),
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
      thid: RESEARCH_ACCESS_TEST_IDS.communicationThreadId,
    });
  }

  /**
   * Ingests one medication-only IPS demo bundle for `Novita`, reusing the
   * shared Ibuprofen/Paracetamol fixture builders already covered elsewhere.
   */
  public async ingestNovitaMedicationFixture(input: {
    thidComm: string;
    thidMedSearch: string;
    thidIpsSearch: string;
    medicationCaseIndex: number;
  }): Promise<any> {
    const request = buildDemoCommunicationBatchSubmitRequest({
      ...demoCommunicationMedicationIpsDefaults,
      subjectId: RESEARCH_ACCESS_TEST_IDS.novitaSubjectDid as typeof demoCommunicationMedicationIpsDefaults.subjectId,
      ...input,
    });

    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: request,
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch-response`,
      thid: input.thidComm,
    });
  }

  /**
   * Builds the VP token that carries the inter-tenant contract VC.
   *
   * This is the proof later consumed by the SMART token endpoint. The contract
   * VC shape itself comes from `gdc-common-utils-ts`.
   */
  public buildResearchAccessContractVpToken(): string {
    return buildDemoResearchContractVpToken({
      tenantId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
      subjectDid: RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid,
      actorDid: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
    });
  }

  private async registerHostedTenant(input: {
    claims: Record<string, unknown>;
    didDocumentId: string;
    sector: Sector;
  }): Promise<void> {
    const tenantId = String(input.claims[ClaimsOrganizationSchemaorg.alternateName] || '');
    const tenantVaultId = getTenantVaultId(String(input.sector), tenantId);
    await this.deps.kmsService.provisionKeys(tenantVaultId);
    const secureTenantRecord = await this.deps.kmsService.protectConfidentialData(
      {
        id: tenantVaultId,
        sequence: 0,
        content: {
          claims: input.claims,
          didConfig: { service: initializeTenantServicesConfig(input.sector) },
          didDocument: {
            id: input.didDocumentId,
            '@context': 'https://www.w3.org/ns/did/v1',
          },
        },
      },
      'host',
    );
    await this.deps.vaultRepository.put(
      buildHostCollectionName(),
      [secureTenantRecord],
      getEnvSectionId('tenants'),
    );
    await this.deps.tenantManager.getTenant(tenantVaultId);
  }
}

/**
 * Test-only facade that mirrors the high-level responsibilities expected from
 * a future `digitalTwinSdk`:
 * - obtain a SMART access token using the research contract proof
 * - search `digitaltwin/.../ResearchSubject/_search` with FHIR Parameters
 * - consume the asynchronous bundle-response contract
 */
export class TestResearchDigitalTwinSdk {
  constructor(
    private readonly deps: Pick<ResearchAccessGatewayDeps, 'app'>,
    private readonly authorizationHeader: string,
  ) {}

  /**
   * Requests a SMART token for the foreign `lab` member using the VP that
   * carries the inter-tenant contract VC.
   */
  public async requestResearchSmartAccessToken(vpToken: string): Promise<any> {
    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: {
        thid: RESEARCH_ACCESS_TEST_IDS.smartTokenThreadId,
        iss: RESEARCH_ACCESS_TEST_IDS.deviceDid,
        aud: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerOrganizationDid,
        body: {
          sub: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONSUMER_PROFESSIONAL_DID,
          purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.purpose,
          scope: `${ServiceCapability.DigitalTwinReader}?subject=${encodeURIComponent(RESEARCH_ACCESS_TEST_IDS.doraemonSubjectDid)}`,
          expires_in: 60,
          vp_token: vpToken,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
        },
      },
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
      thid: RESEARCH_ACCESS_TEST_IDS.smartTokenThreadId,
    });
  }

  /**
   * Requests one SMART token for the selected research employee variant using
   * the shared request builder.
   */
  public async requestResearchSmartAccessTokenForRequester(input: {
    subjectDid: string;
    actorDid: string;
    actorEmail: string;
    actorRole: string;
    clientSuffix: string;
    thid: string;
  }): Promise<any> {
    const requestPayload = await buildDemoResearchSmartTokenRequest({
      tenantId: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_CONTEXT.providerTenantId,
      subjectDid: input.subjectDid,
      actorDid: input.actorDid,
      actorEmail: input.actorEmail,
      actorRole: input.actorRole,
      clientSuffix: input.clientSuffix,
      thid: input.thid,
    });

    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/token`,
      headers: { 'content-type': 'application/json', authorization: this.authorizationHeader },
      body: requestPayload,
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/smart/_batch-response`,
      thid: input.thid,
    });
  }

  /**
   * Searches the provider digital-twin medication index by coded data.
   */
  public async searchMedicationTwinsByCode(accessToken: string): Promise<any> {
    return this.searchMedicationTwinsByCodeValue(accessToken, RESEARCH_ACCESS_SEARCH_FIXTURE.medicationCode);
  }

  /**
   * Searches the provider digital-twin index by one exact medication code.
   */
  public async searchMedicationTwinsByCodeValue(
    accessToken: string,
    medicationCode: string,
  ): Promise<any> {
    const searchThreadId = `${RESEARCH_ACCESS_TEST_IDS.compositionSearchThreadId}-${String(medicationCode || '').split('|').pop()}`;
    const submitResp = await invokeExpress(this.deps.app, {
      method: 'POST',
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: {
        thid: searchThreadId,
        body: {
          resourceType: 'Parameters',
          parameter: [
            { name: 'section', valueString: RESEARCH_ACCESS_SEARCH_FIXTURE.section },
            { name: RESEARCH_ACCESS_SEARCH_FIXTURE.codeClaim, valueString: medicationCode },
          ],
        },
      },
    });

    if (submitResp.status !== 202) {
      return undefined;
    }

    return pollAcceptedGatewayOperation({
      app: this.deps.app,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/digitaltwin/org.hl7.fhir.api/ResearchSubject/_batch-response`,
      thid: searchThreadId,
    });
  }
}
