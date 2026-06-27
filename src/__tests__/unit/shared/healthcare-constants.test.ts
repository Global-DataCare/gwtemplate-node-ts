import { describe, expect, it } from '@jest/globals';
import { HealthcareBasicSections, HealthcareSummarySections } from '../../../shared/healthcare-constants';

describe('shared healthcare constants', () => {
  it('extends HealthcareBasicSections with the IPS sections missing upstream', () => {
    expect(HealthcareBasicSections.Alert.attributeValue).toBe('http://loinc.org|104605-1');
    expect(HealthcareBasicSections.PregnancyHistory.attributeValue).toBe('http://loinc.org|10162-6');
    expect(HealthcareBasicSections.GoalsAndPreferences.attributeValue).toBe('http://loinc.org|81338-6');
  });

  it('exposes an IPS-oriented HealthcareSummarySections subset', () => {
    expect(HealthcareSummarySections.Alert).toBeDefined();
    expect(HealthcareSummarySections.PregnancyHistory).toBeDefined();
    expect(HealthcareSummarySections.GoalsAndPreferences).toBeDefined();

    expect('DietAndNutrition' in HealthcareSummarySections).toBe(false);
    expect('HistoryOfFamilyMemberDiseases' in HealthcareSummarySections).toBe(false);
    expect('HistoryOfHospitalizationsAndOutpatientVisits' in HealthcareSummarySections).toBe(false);
    expect('HistoryOfPresentIllness' in HealthcareSummarySections).toBe(false);
    expect('ProblemListNarrativeReported' in HealthcareSummarySections).toBe(false);
    expect('Instructions' in HealthcareSummarySections).toBe(false);
  });
});
