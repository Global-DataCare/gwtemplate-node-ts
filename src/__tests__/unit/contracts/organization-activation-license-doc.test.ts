/**
 * Flow contract:
 * 1. Order issues the controller activation code from an annual GW licence.
 * 2. Token exchange validates the authenticated recipient and licence expiry.
 * 3. DCR follows successful exchange; portal PDF/login codes are unrelated.
 * Authorization invariant: possession without the licensed verified identity is insufficient.
 * Persistence invariant: GW owns activation-code lookup, annual expiry and active state.
 */
import { readFileSync } from 'node:fs';

describe('organization activation licence documentation', () => {
  it('separates current GW behavior from future delivery and renewal automation', () => {
    const guide = readFileSync('docs/03-IDENTITY-AND-TRUST/03.I-ORGANIZATION-ACTIVATION-LICENCE.md', 'utf8');
    expect(guide).toContain('Order → activation licence → Token/_exchange → Device/_dcr');
    expect(guide).toContain('annual licence expiry');
    expect(guide).toContain('Test Network email');
    expect(guide).toContain('production postal delivery');
    expect(guide).toContain('one month before expiry');
    expect(guide).toContain('TODO');
  });
});
