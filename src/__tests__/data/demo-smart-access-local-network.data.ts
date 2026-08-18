// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import {
  HealthcareActorRoles,
  HealthcareBasicSections,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/healthcare';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  EXAMPLE_API_ORGANIZATION_DID,
  EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
  EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
  EXAMPLE_RESEARCH_CONTROLLER_DID,
  EXAMPLE_TENANT_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE } from 'gdc-common-utils-ts/examples/inter-tenant-access-contract';
import { ClaimConsent, ConsentDecisions, type ConsentRule } from 'gdc-common-utils-ts/models/consent-rule';
import { ClaimInterTenantAccessContract } from 'gdc-common-utils-ts/models/inter-tenant-access-contract';
import { MedicationStatementClaim } from 'gdc-common-utils-ts/models/interoperable-claims';
import {
  buildClientAssertionJwt,
  buildInterTenantAccessContractCredential,
  buildUnsignedProfessionalIdentityVpJwt,
  createVP,
  addVC,
} from 'gdc-common-utils-ts';
import { demoCommunicationMedicationIpsDefaults } from './demo-communication-medications-ips.data';

/**
 * Canonical ids reused by the local-network SMART access smoke.
 *
 * The goal is to keep the shell scripts free from ad-hoc strings while still
 * making each step self-explanatory in logs and polls.
 */
export const DEMO_SMART_ACCESS_LOCAL_IDS = Object.freeze({
  individualSmartThreadId: 'local-network-individual-smart-token-001',
  individualBundleSearchThreadId: 'local-network-individual-bundle-search-001',
  individualConsentIdentifier: 'urn:uuid:local-network-individual-ips-consent-001',
  researchRoleSmartThreadId: 'local-network-research-role-smart-token-001',
  researchRoleDeniedSmartThreadId: 'local-network-research-role-smart-token-denied-001',
  researchEmailSmartThreadId: 'local-network-research-email-smart-token-001',
  researchEmailDeniedSmartThreadId: 'local-network-research-email-smart-token-denied-001',
  digitalTwinSearchThreadId: 'local-network-digitaltwin-composition-search-001',
  researchContractIdentifier: 'urn:uuid:local-network-inter-tenant-contract-001',
  researchRoleConsentIdentifier: 'urn:uuid:local-network-research-role-consent-001',
  researchDirectEmailConsentIdentifier: 'urn:uuid:local-network-research-email-consent-001',
} as const);

export const DEMO_SMART_ACCESS_LOCAL_EMAILS = Object.freeze({
  individualProfessional: 'doctor1@acme.org',
  researchAllowed: 'researcher1@lab.org',
  researchDenied: 'researcher2@lab.org',
} as const);

export const DEMO_SMART_ACCESS_LOCAL_DIDS = Object.freeze({
  consumerOrganizationDid: 'did:web:api.lab.org',
  providerControllerDid: EXAMPLE_CONTROLLER_DID,
  consumerControllerDid: EXAMPLE_RESEARCH_CONTROLLER_DID,
  consumerDeviceDid: 'did:web:device.lab.org',
} as const);

function buildProviderOrganizationDid(tenantId: string): string {
  if (String(tenantId || '').trim() === EXAMPLE_TENANT_IDENTIFIER) {
    return EXAMPLE_API_ORGANIZATION_DID;
  }
  return `did:web:api.${String(tenantId || '').trim()}.org`;
}

function buildIndividualProfessionalDid(tenantId: string): string {
  return `${buildProviderOrganizationDid(tenantId)}:employee:${DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional}:${HealthcareActorRoles.Physician}`;
}

function buildIndividualClientId(tenantId: string): string {
  return `${buildProviderOrganizationDid(tenantId)}:employee:${DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional}:device:client-local-individual`;
}

function buildResearchProfessionalDid(role: string, email: string): string {
  return `${DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid}:employee:${email}:${role}`;
}

function buildResearchClientId(email: string, suffix: string): string {
  return `${DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid}:employee:${email}:device:${suffix}`;
}

/**
 * Builds one realistic VP token for the local individual-professional SMART
 * request. The current demo gateway accepts placeholder VPs, but this helper
 * keeps the local smoke aligned with the shared professional identity VC/VP
 * model.
 */
export function buildDemoIndividualProfessionalVpToken(input: Readonly<{
  tenantId: string;
}>): string {
  return buildUnsignedProfessionalIdentityVpJwt({
    clientId: buildIndividualClientId(input.tenantId),
    actorDid: buildIndividualProfessionalDid(input.tenantId),
    role: HealthcareActorRoles.Physician,
    email: DEMO_SMART_ACCESS_LOCAL_EMAILS.individualProfessional,
  });
}

/**
 * Builds the exact subject, actor, purpose and IPS-section consent consumed by
 * the mandatory same-portal SMART release smoke. Keeping this rule beside the
 * token fixture makes the smoke self-contained instead of relying on an
 * unrelated generic ConsentAccess example having run first.
 */
export function buildDemoIndividualIpsPermitConsent(input: Readonly<{
  tenantId: string;
  subjectDid: string;
}>): ConsentRule {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.identifier]: DEMO_SMART_ACCESS_LOCAL_IDS.individualConsentIdentifier,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: buildIndividualProfessionalDid(input.tenantId),
    [ClaimConsent.actorRole]: HealthcareActorRoles.Physician,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.purpose]: HealthcareConsentPurposes.EmergencyTreatment,
    [ClaimConsent.action]: HealthcareBasicSections.PatientSummaryDocument.claim,
    [ClaimConsent.date]: '2026-08-01',
    [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
    [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  } as const;
}

/**
 * Builds one `smart/token` request body for the current local individual
 * consent smoke.
 */
export async function buildDemoIndividualSmartTokenRequest(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  clientAssertionAudience?: string;
}>): Promise<Record<string, unknown>> {
  const clientId = buildIndividualClientId(input.tenantId);
  const audience = buildProviderOrganizationDid(input.tenantId);
  const scope =
    `${ServiceCapability.IndexReader}?subject=${String(input.subjectDid || '').trim()}`
    + `&section=${HealthcareBasicSections.PatientSummaryDocument.claim}`;
  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.individualSmartThreadId,
    iss: clientId,
    aud: audience,
    body: {
      client_id: clientId,
      client_assertion: await buildClientAssertionJwt({
        clientId,
        audience: input.clientAssertionAudience || audience,
      }),
      client_assertion_type: 'private_key_jwt',
      sub: buildIndividualProfessionalDid(input.tenantId),
      purpose: HealthcareConsentPurposes.EmergencyTreatment,
      scope,
      expires_in: 60,
      vp_token: buildDemoIndividualProfessionalVpToken({ tenantId: input.tenantId }),
      acr_values: 'urn:antifraud:acr:openid4vp:employee',
    },
  };
}

/**
 * Builds one canonical `Bundle/_search` request that reads the IPS document
 * for the current subject.
 */
export function buildDemoIndividualIpsSearchRequest(input: Readonly<{
  subjectDid: string;
}>): Record<string, unknown> {
  const subjectDid = String(input.subjectDid || '').trim();
  const compositionType = HealthcareBasicSections.PatientSummaryDocument.claim;
  return {
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
              + `&composition.type=${encodeURIComponent(compositionType)}`,
          },
        },
      ],
    },
  };
}

/**
 * Builds one live provider-side consent rule that allows the consumer
 * organization when the requester role matches.
 */
export function buildDemoResearchPermitByRoleConsent(input: Readonly<{
  subjectDid: string;
}>): ConsentRule {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.identifier]: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleConsentIdentifier,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
    [ClaimConsent.actorRole]: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
    [ClaimConsent.date]: '2026-06-30',
    [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
    [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  } as const;
}

/**
 * Builds one live provider-side consent rule that directly targets one allowed
 * research employee email.
 */
export function buildDemoResearchPermitByEmailConsent(input: Readonly<{
  subjectDid: string;
}>): ConsentRule {
  return {
    '@context': 'org.hl7.fhir.api',
    [ClaimConsent.identifier]: DEMO_SMART_ACCESS_LOCAL_IDS.researchDirectEmailConsentIdentifier,
    [ClaimConsent.subject]: String(input.subjectDid || '').trim(),
    [ClaimConsent.actorIdentifier]: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
    [ClaimConsent.actorRole]: HealthcareActorRoles.NursingProfessional,
    [ClaimConsent.decision]: ConsentDecisions.Permit,
    [ClaimConsent.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
    [ClaimConsent.action]: ServiceCapability.DigitalTwinReader,
    [ClaimConsent.date]: '2026-06-30',
    [ClaimConsent.attachmentContentType]: EXAMPLE_CONSENT_ATTACHMENT_CONTENT_TYPE,
    [ClaimConsent.attachmentData]: EXAMPLE_CONSENT_ATTACHMENT_DATA_BASE64,
  } as const;
}

function buildDemoResearchContractCredential(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  providerOrganizationDid?: string;
}>): Record<string, unknown> {
  const providerOrganizationDid = input.providerOrganizationDid || buildProviderOrganizationDid(input.tenantId);
  return buildInterTenantAccessContractCredential({
    issuer: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerControllerDid,
    validFrom: '2026-06-30T00:00:00.000Z',
    validUntil: '2027-06-30T00:00:00.000Z',
    additionalCredential: {
      id: DEMO_SMART_ACCESS_LOCAL_IDS.researchContractIdentifier,
    },
    claims: {
      [ClaimInterTenantAccessContract.identifier]: DEMO_SMART_ACCESS_LOCAL_IDS.researchContractIdentifier,
      [ClaimInterTenantAccessContract.status]: 'executed',
      [ClaimInterTenantAccessContract.issued]: '2026-06-30T00:00:00.000Z',
      [ClaimInterTenantAccessContract.appliesStart]: '2026-06-30T00:00:00.000Z',
      [ClaimInterTenantAccessContract.appliesEnd]: '2027-06-30T00:00:00.000Z',
      [ClaimInterTenantAccessContract.providerOrganization]: providerOrganizationDid,
      [ClaimInterTenantAccessContract.consumerOrganization]: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
      [ClaimInterTenantAccessContract.providerController]: DEMO_SMART_ACCESS_LOCAL_DIDS.providerControllerDid,
      [ClaimInterTenantAccessContract.consumerController]: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerControllerDid,
      [ClaimInterTenantAccessContract.capability]: ServiceCapability.DigitalTwinReader,
      [ClaimInterTenantAccessContract.purpose]: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      [ClaimInterTenantAccessContract.instantiatesUri]: 'https://portal.example.org/contracts/local-network-research-access-001.pdf',
    },
  }) as unknown as Record<string, unknown>;
}

/**
 * Builds one VP token that carries the inter-tenant research contract VC for
 * the selected requester.
 */
export function buildDemoResearchContractVpToken(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  actorDid: string;
  providerOrganizationDid?: string;
}>): string {
  const vpPayload = createVP({
    iss: DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid,
    sub: String(input.actorDid || '').trim(),
  });
  addVC(vpPayload, buildDemoResearchContractCredential({
    tenantId: input.tenantId,
    subjectDid: input.subjectDid,
    providerOrganizationDid: input.providerOrganizationDid,
  }));
  return JSON.stringify(vpPayload);
}

/**
 * Builds one SMART token request for the local research/digital-twin flow.
 */
export async function buildDemoResearchSmartTokenRequest(input: Readonly<{
  tenantId: string;
  subjectDid: string;
  actorDid: string;
  actorEmail: string;
  actorRole: string;
  clientSuffix: string;
  thid: string;
  clientAssertionAudience?: string;
  providerOrganizationDid?: string;
}>): Promise<Record<string, unknown>> {
  const clientId = buildResearchClientId(input.actorEmail, input.clientSuffix);
  const audience = input.providerOrganizationDid || buildProviderOrganizationDid(input.tenantId);
  const scope =
    `${ServiceCapability.DigitalTwinReader}?subject=${encodeURIComponent(String(input.subjectDid || '').trim())}`;
  return {
    thid: input.thid,
    iss: clientId,
    aud: audience,
    body: {
      client_id: clientId,
      client_assertion: await buildClientAssertionJwt({
        clientId,
        audience: input.clientAssertionAudience || audience,
      }),
      client_assertion_type: 'client_assertion',
      sub: String(input.actorDid || '').trim(),
      purpose: EXAMPLE_INTER_TENANT_ACCESS_CONTRACT_PURPOSE,
      scope,
      expires_in: 60,
      vp_token: buildDemoResearchContractVpToken({
        tenantId: input.tenantId,
        subjectDid: input.subjectDid,
        actorDid: input.actorDid,
        providerOrganizationDid: audience,
      }),
      acr_values: 'urn:antifraud:acr:openid4vp:employee',
    },
  };
}

/**
 * Builds the canonical digital-twin `Composition/_search` request used by the
 * local research smoke.
 */
export function buildDemoDigitalTwinCompositionSearchRequest(): Record<string, unknown> {
  const ibuprofenCode = demoCommunicationMedicationIpsDefaults.demoMedicationCases[0].demoMedicationCode;
  return {
    thid: DEMO_SMART_ACCESS_LOCAL_IDS.digitalTwinSearchThreadId,
    body: {
      resourceType: 'Parameters',
      parameter: [
        { name: 'section', valueString: HealthcareBasicSections.HistoryOfMedicationUse.attributeValue },
        // Research projections intentionally remove free text such as
        // `code-text`; use the preserved token claim for deterministic
        // digital-twin discovery without weakening de-identification.
        { name: MedicationStatementClaim.Code, valueString: ibuprofenCode },
      ],
    },
  };
}

/**
 * Returns the canonical role/email requester matrix used by the local-network
 * research smoke.
 */
export function buildDemoResearchRequesterMatrix(): Readonly<{
  allowByRole: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
  denyByRole: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
  allowByEmail: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
  denyByEmail: { actorDid: string; actorEmail: string; actorRole: string; clientSuffix: string; thid: string };
}> {
  return {
    allowByRole: {
      actorDid: buildResearchProfessionalDid(EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      actorRole: EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN,
      clientSuffix: 'client-role-allow',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleSmartThreadId,
    },
    denyByRole: {
      actorDid: buildResearchProfessionalDid(HealthcareActorRoles.NursingProfessional, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
      actorRole: HealthcareActorRoles.NursingProfessional,
      clientSuffix: 'client-role-deny',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchRoleDeniedSmartThreadId,
    },
    allowByEmail: {
      actorDid: buildResearchProfessionalDid(HealthcareActorRoles.NursingProfessional, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchAllowed,
      actorRole: HealthcareActorRoles.NursingProfessional,
      clientSuffix: 'client-email-allow',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchEmailSmartThreadId,
    },
    denyByEmail: {
      actorDid: buildResearchProfessionalDid(HealthcareActorRoles.NursingProfessional, DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied),
      actorEmail: DEMO_SMART_ACCESS_LOCAL_EMAILS.researchDenied,
      actorRole: HealthcareActorRoles.NursingProfessional,
      clientSuffix: 'client-email-deny',
      thid: DEMO_SMART_ACCESS_LOCAL_IDS.researchEmailDeniedSmartThreadId,
    },
  } as const;
}

/**
 * Minimal claims projection for the direct-email research permit smoke.
 */
export function buildDemoResearchRequesterClaims(email: string): Readonly<Record<string, string>> {
  return Object.freeze({
    '@context': 'org.schema',
    [ClaimsPersonSchemaorg.email]: String(email || '').trim(),
  });
}
