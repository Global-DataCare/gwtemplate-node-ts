// TDD contract: write this test red first; make it green only with the complete real behavior.
import {
  buildCareOrganizationLedgerChannel,
  buildPolicyOwnerLedgerChannel,
  LedgerRegions,
} from '../../../blockchain/fabric/v3/ledger-channel-name';

describe('ledger channel ownership taxonomy', () => {
  it('routes policy by its owner instead of the provider sector', () => {
    expect(buildPolicyOwnerLedgerChannel('individual', LedgerRegions.EU)).toBe('identity-global');
    expect(buildPolicyOwnerLedgerChannel('animal', LedgerRegions.EU)).toBe('animal-pet-eu');
    expect(buildPolicyOwnerLedgerChannel('organization', LedgerRegions.EU)).toBe('antifraud-eu');
  });

  it('keeps human-care and animal-care organization planes symmetric', () => {
    expect(buildCareOrganizationLedgerChannel('human', LedgerRegions.NA)).toBe('health-care-na');
    expect(buildCareOrganizationLedgerChannel('animal', LedgerRegions.NA)).toBe('animal-care-na');
  });
});
