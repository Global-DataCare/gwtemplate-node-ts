import {
  buildSectorsFromMainAndSubsectors,
  parseAndValidateMainSector,
  parseAndValidateSectors,
  parseAndValidateSubsectors,
  resolveAllowedSectorsFromEnv,
} from '../../../config/server-config';

describe('server-config sector resolution', () => {
  it('should resolve synthetic sectors from MAINSECTOR + SUBSECTORSALLOWED', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      MAINSECTOR: 'animal',
      SUBSECTORSALLOWED: 'research,care,index,tech',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['animal-research', 'animal-care', 'animal-index', 'animal-tech']);
  });

  it('should default subsectors when SUBSECTORSALLOWED is missing', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      MAINSECTOR: 'health',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['health-research', 'health-care', 'health-index']);
  });

  it('should prioritize deprecated SECTORS_ALLOWED when present', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      MAINSECTOR: 'animal',
      SUBSECTORSALLOWED: 'research,care,index',
      SECTORS_ALLOWED: 'health-care,research',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['health-care', 'research']);
  });

  it('should accept synthetic sectors in deprecated SECTORS_ALLOWED', () => {
    expect(parseAndValidateSectors('animal-care,animal-index,animal-tech')).toEqual([
      'animal-care',
      'animal-index',
      'animal-tech',
    ]);
  });

  it('should validate MAINSECTOR values', () => {
    expect(parseAndValidateMainSector('animal')).toBe('animal');
    expect(() => parseAndValidateMainSector('finance')).toThrow(
      /Invalid MAINSECTOR/
    );
  });

  it('should validate SUBSECTORSALLOWED values', () => {
    expect(parseAndValidateSubsectors('research,care,index,tech')).toEqual([
      'research',
      'care',
      'index',
      'tech',
    ]);
    expect(() => parseAndValidateSubsectors('care,unknown')).toThrow(
      /Invalid SUBSECTORSALLOWED/
    );
  });

  it('should build sectors consistently from main and subsectors', () => {
    expect(buildSectorsFromMainAndSubsectors('animal', ['care'])).toEqual([
      'animal-care',
    ]);
  });
});
