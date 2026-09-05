// TDD contract: write this test red first; make it green only with the complete real behavior.
/**
 * Flow contract: managers derive governed ledger routes from trusted domain
 * context; callers and deployment overrides cannot select clinical channels
 * or contracts. Natural persons and legal organizations retain their distinct
 * identity planes.
 */
import {
  ClinicalEvidenceChaincode,
  ConsentAccessChaincode,
  resolveClinicalDataChannel,
  resolveIdentityChannel,
  resolveOrganizationIdentityChannel,
  resolveSubjectIdentityChannel,
} from '../../../utils/ledger';

describe('manager-owned clinical ledger routing', () => {
  const originalNetworkMode = process.env.NETWORK_MODE;

  afterEach(() => {
    if (originalNetworkMode === undefined) delete process.env.NETWORK_MODE;
    else process.env.NETWORK_MODE = originalNetworkMode;
  });

  it('maps country jurisdiction to the governed shared region', () => {
    process.env.NETWORK_MODE = 'test';
    expect(resolveClinicalDataChannel('health-care', 'ES')).toBe('health-care-eu');
  });

  it('uses the canonical local topology without a configured channel name', () => {
    process.env.NETWORK_MODE = 'local-network';
    expect(resolveClinicalDataChannel('health-care', 'ES')).toBe('health-care-local');
  });

  it('owns the clinical and consent smart-contract selections', () => {
    expect(ClinicalEvidenceChaincode).toBe('artifact-sc');
    expect(ConsentAccessChaincode).toBe('consentaccess-sc');
  });

  it('fails closed without trusted domain context', () => {
    expect(() => resolveClinicalDataChannel('', 'ES')).toThrow('Trusted sector and jurisdiction');
    expect(() => resolveClinicalDataChannel('health-care', '')).toThrow('Trusted sector and jurisdiction');
  });
});

describe('resolveIdentityChannel', () => {
  const originalNetworkMode = process.env.NETWORK_MODE;
  const originalIdentityChannelDefault = process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;
  const originalOrganizationIdentityChannelDefault =
    process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT;

  afterEach(() => {
    if (originalNetworkMode === undefined) {
      delete process.env.NETWORK_MODE;
    } else {
      process.env.NETWORK_MODE = originalNetworkMode;
    }

    if (originalIdentityChannelDefault === undefined) {
      delete process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;
    } else {
      process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT = originalIdentityChannelDefault;
    }

    if (originalOrganizationIdentityChannelDefault === undefined) {
      delete process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT;
    } else {
      process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT =
        originalOrganizationIdentityChannelDefault;
    }
  });

  it('returns the explicit identity channel override when configured', () => {
    process.env.NETWORK_MODE = 'local-network';
    process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT = 'identity-override';

    expect(resolveIdentityChannel('ES')).toBe('identity-override');
  });

  it('returns identity-local for local-network when no explicit override exists', () => {
    process.env.NETWORK_MODE = 'local-network';
    delete process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;

    expect(resolveIdentityChannel('ES')).toBe('identity-local');
  });

  it('uses global human identity outside local-network regardless of jurisdiction', () => {
    process.env.NETWORK_MODE = 'test-network';
    delete process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT;

    expect(resolveIdentityChannel('ES')).toBe('identity-global');
    expect(resolveIdentityChannel('US')).toBe('identity-global');
  });

  it('keeps EU organizations and employees on identity-eu', () => {
    process.env.NETWORK_MODE = 'test-network';
    delete process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT;

    expect(resolveOrganizationIdentityChannel('ES')).toBe('identity-eu');
    expect(resolveSubjectIdentityChannel('employee', 'ES')).toBe('identity-eu');
  });

  it('keeps natural persons on identity-global', () => {
    process.env.NETWORK_MODE = 'test-network';
    expect(resolveSubjectIdentityChannel('person', 'ES')).toBe('identity-global');
  });

  it('fails closed for an unconfigured non-EU organization region', () => {
    process.env.NETWORK_MODE = 'test-network';
    delete process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT;
    expect(() => resolveOrganizationIdentityChannel('US')).toThrow(
      'Organization identity channel is not configured',
    );
  });

  it('accepts an explicit organization identity channel for another region', () => {
    process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT = 'identity-na';
    expect(resolveOrganizationIdentityChannel('US')).toBe('identity-na');
  });
});
