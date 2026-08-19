import { isFhirSector } from '../../../utils/sector';

describe('FHIR sector classification', () => {
  it('supports antifraud FHIR resources without classifying it as health or animal', () => {
    expect(isFhirSector('antifraud')).toBe(true);
    expect(isFhirSector('onehealth-research')).toBe(true);
    expect(isFhirSector('company-book')).toBe(false);
    expect(isFhirSector('family-book')).toBe(false);
  });
});
