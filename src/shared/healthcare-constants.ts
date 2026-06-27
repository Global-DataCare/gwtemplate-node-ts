import {
  CommunicationCategoryCodes,
  FhirCodeSystems,
  HealthcareActorRoleCodes,
  HealthcareActorRoles,
  HealthcareAdditionalSections,
  HealthcareAllSections as CommonHealthcareAllSections,
  HealthcareBasicSections as CommonHealthcareBasicSections,
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/index';

type HealthcareSectionDescriptor = typeof CommonHealthcareBasicSections.PatientSummaryDocument;

const LOINC_SECTION_SYSTEM = CommonHealthcareBasicSections.PatientSummaryDocument.system;

function createHealthcareSectionDescriptor(
  code: string,
  i18nKey: `org.loinc.${string}`,
  titleEn: string,
): HealthcareSectionDescriptor {
  const attributeValue = `${LOINC_SECTION_SYSTEM}|${code}`;
  return Object.freeze({
    system: LOINC_SECTION_SYSTEM,
    code,
    attributeValue,
    claim: attributeValue,
    i18nKey,
    titleEn,
  });
}

/**
 * Local extension of `gdc-common-utils-ts` basic IPS sections.
 *
 * The upstream package still lacks a few section tokens that are present in
 * the canonical HL7 IPS all-sections example used by this repository. We
 * extend the exported object here so the rest of the GW codebase can keep
 * consuming one shared catalog instead of sprinkling local literals in
 * managers, tests and docs.
 */
export const HealthcareBasicSections = Object.freeze({
  ...CommonHealthcareBasicSections,
  Alert: createHealthcareSectionDescriptor(
    '104605-1',
    'org.loinc.104605-1',
    'Alert',
  ),
  PregnancyHistory: createHealthcareSectionDescriptor(
    '10162-6',
    'org.loinc.10162-6',
    'Pregnancy History',
  ),
  GoalsAndPreferences: createHealthcareSectionDescriptor(
    '81338-6',
    'org.loinc.81338-6',
    'Goals / Preferences',
  ),
} as const);

/**
 * IPS summary-oriented subset used by the gateway when the intent is "full
 * patient summary / digital twin" rather than the broader common-utils core
 * catalog.
 *
 * It starts from `HealthcareBasicSections`, includes the extra IPS sections
 * present in the official HL7 IPS all-sections example, and excludes the basic
 * common-utils sections that are outside that example:
 * - Diet and Nutrition
 * - History of Family Member Diseases
 * - History of Hospitalizations and Outpatient Visits
 * - History of Present Illness
 * - Problem List Narrative Reported
 * - Instructions
 */
export const HealthcareSummarySections = Object.freeze({
  PatientSummaryDocument: HealthcareBasicSections.PatientSummaryDocument,
  AllergiesAndIntolerances: HealthcareBasicSections.AllergiesAndIntolerances,
  HistoryOfMedicationUse: HealthcareBasicSections.HistoryOfMedicationUse,
  ProblemList: HealthcareBasicSections.ProblemList,
  Results: HealthcareBasicSections.Results,
  Procedures: HealthcareBasicSections.Procedures,
  Immunizations: HealthcareBasicSections.Immunizations,
  MedicalDevices: HealthcareBasicSections.MedicalDevices,
  VitalSigns: HealthcareBasicSections.VitalSigns,
  SocialHistory: HealthcareBasicSections.SocialHistory,
  Alert: HealthcareBasicSections.Alert,
  GoalsAndPreferences: HealthcareBasicSections.GoalsAndPreferences,
  AdvanceDirectives: HealthcareBasicSections.AdvanceDirectives,
  FunctionalStatus: HealthcareBasicSections.FunctionalStatus,
  HistoryOfPastIllness: HealthcareBasicSections.HistoryOfPastIllness,
  PregnancyHistory: HealthcareBasicSections.PregnancyHistory,
  PlanOfCare: HealthcareBasicSections.PlanOfCare,
  PlanOfTreatment: HealthcareBasicSections.PlanOfTreatment,
} as const);

export const HealthcareAllSections = Object.freeze({
  ...CommonHealthcareAllSections,
  Alert: HealthcareBasicSections.Alert,
  PregnancyHistory: HealthcareBasicSections.PregnancyHistory,
  GoalsAndPreferences: HealthcareBasicSections.GoalsAndPreferences,
} as const);

export {
  CommunicationCategoryCodes,
  FhirCodeSystems,
  HealthcareActorRoleCodes,
  HealthcareActorRoles,
  HealthcareAdditionalSections,
  HealthcareConsentActions,
  HealthcareConsentPurposes,
};
