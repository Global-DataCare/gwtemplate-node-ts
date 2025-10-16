// src/__tests__/utils/identifier-parser.test.ts

import { parseIdentifierType } from "../../utils/identifier-parser";

describe('parseIdentifierType', () => {
  it('should correctly parse a type with a country code and a subdivision', () => {
    const result = parseIdentifierType('JHNES-CL');
    expect(result).toEqual({
      type: 'JHN',
      countryCode: 'ES',
      subdivision: 'CL',
    });
  });

  it('should correctly parse a type with only a country code (convention)', () => {
    const result = parseIdentifierType('NNES');
    expect(result).toEqual({
      type: 'NN',
      countryCode: 'ES',
      subdivision: undefined,
    });
  });

  it('should correctly parse a type with a 3-letter code and country', () => {
    const result = parseIdentifierType('PPNFR');
    expect(result).toEqual({
      type: 'PPN',
      countryCode: 'FR',
      subdivision: undefined,
    });
  });

  it('should correctly parse a type with a 2-letter code, country, and subdivision', () => {
    const result = parseIdentifierType('DLCA-BC');
    expect(result).toEqual({
      type: 'DL',
      countryCode: 'CA',
      subdivision: 'BC',
    });
  });

  it('should return the original type if it does not match a known pattern', () => {
    const result = parseIdentifierType('UNKNOWN');
    expect(result).toEqual({
      type: 'UNKNOWN',
      countryCode: undefined,
      subdivision: undefined,
    });
  });

  it('should handle types with no country code gracefully', () => {
    const result = parseIdentifierType('TAX');
    expect(result).toEqual({
      type: 'TAX',
      countryCode: undefined,
      subdivision: undefined,
    });
  });
    
  it('should handle an empty string', () => {
    const result = parseIdentifierType('');
    expect(result).toEqual({
      type: '',
      countryCode: undefined,
      subdivision: undefined,
    });
  });
});
