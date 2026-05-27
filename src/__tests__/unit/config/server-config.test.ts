import {
  buildSectorsFromMainAndSubsectors,
  getConfig,
  parseAndValidateMainSector,
  parseAndValidateSectors,
  parseAndValidateSubsectors,
  parseNetworkMode,
  parseSecurityMode,
  resetServerConfig,
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

  it('should parse SECURITY_MODE values', () => {
    expect(parseSecurityMode('strict')).toBe('strict');
    expect(parseSecurityMode('compat')).toBe('compat');
    expect(parseSecurityMode('demo')).toBe('demo');
    expect(parseSecurityMode(undefined)).toBe('strict');
    expect(() => parseSecurityMode('invalid-mode')).toThrow(/Invalid SECURITY_MODE/);
  });

  it('should parse NETWORK_MODE values and fallback by NODE_ENV', () => {
    expect(parseNetworkMode('test')).toBe('test');
    expect(parseNetworkMode('test-network')).toBe('test-network');
    expect(parseNetworkMode('network')).toBe('network');

    expect(parseNetworkMode(undefined, 'production')).toBe('network');
    expect(parseNetworkMode(undefined, 'staging')).toBe('test-network');
    expect(parseNetworkMode(undefined, 'test')).toBe('test');
    expect(() => parseNetworkMode('invalid-mode')).toThrow(/Invalid NETWORK_MODE/);
  });

  it('should expose security and network flags from environment', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      NETWORK_MODE: 'test-network',
      FHIR_LEGACY: 'true',
      JSON_LEGACY: '1',
      DIDCOMM_PLAIN: 'enabled',
      DEMO_ALLOW_INSECURE_BEARER: 'yes',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.securityMode).toBe('compat');
    expect(config.networkMode).toBe('test-network');
    expect(config.fhirLegacy).toBe(true);
    expect(config.jsonLegacy).toBe(true);
    expect(config.didcommPlainEnabled).toBe(true);
    expect(config.demoAllowInsecureBearer).toBe(true);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should default security flags to disabled and map NETWORK_MODE by NODE_ENV', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      NODE_ENV: 'production',
      SECURITY_MODE: '',
      NETWORK_MODE: '',
      FHIR_LEGACY: '',
      JSON_LEGACY: '',
      DIDCOMM_PLAIN: '',
      DEMO_ALLOW_INSECURE_BEARER: '',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.securityMode).toBe('strict');
    expect(config.networkMode).toBe('network');
    expect(config.fhirLegacy).toBe(false);
    expect(config.jsonLegacy).toBe(false);
    expect(config.didcommPlainEnabled).toBe(false);
    expect(config.demoAllowInsecureBearer).toBe(false);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should expose Supabase storage settings from environment', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_STORAGE_BUCKET: 'gw-files',
      SUPABASE_STORAGE_PUBLIC: 'true',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.storageProvider).toBe('supabase');
    expect(config.supabase).toEqual({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
      storageBucket: 'gw-files',
      storagePublic: true,
    });

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should accept every SECURITY_MODE x NETWORK_MODE pair independently', () => {
    const previousEnv = process.env;
    const securityModes = ['strict', 'compat', 'demo'] as const;
    const networkModes = ['test', 'test-network', 'network'] as const;

    for (const securityMode of securityModes) {
      for (const networkMode of networkModes) {
        process.env = {
          ...previousEnv,
          SECURITY_MODE: securityMode,
          NETWORK_MODE: networkMode,
        };
        resetServerConfig();
        const config = getConfig();
        expect(config.securityMode).toBe(securityMode);
        expect(config.networkMode).toBe(networkMode);
      }
    }

    process.env = previousEnv;
    resetServerConfig();
  });
});
