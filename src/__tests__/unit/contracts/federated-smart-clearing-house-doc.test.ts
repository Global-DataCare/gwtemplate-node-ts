// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'node:fs';

const CONTRACT_PATH = 'docs/03-IDENTITY-AND-TRUST/03.L-FEDERATED-SMART-CLEARING-HOUSE.md';

describe('federated SMART Clearing House documentation', () => {
  it('defines the index-audience, transitional VP, and tenant verification boundaries', () => {
    const contract = readFileSync(CONTRACT_PATH, 'utf8');
    const rootReadme = readFileSync('README.md', 'utf8');
    const docsReadme = readFileSync('docs/README.md', 'utf8');

    expect(contract).toContain('The index provider remains the SMART token audience');
    expect(contract).toContain('client_assertion.vp');
    expect(contract).toContain('body.vp_token');
    expect(contract).toContain('RFC 7662');
    expect(contract).toContain('profiled OAuth token introspection');
    expect(contract).toContain('application/token-introspection+jwt');
    expect(contract).toContain('token_introspection.vp_token');
    expect(contract).toContain('decodeJwt(compactVp).vp');
    expect(contract).toContain('/identity/openid/smart/token/_verify');
    expect(contract).toContain('EHR presents the original SMART token');
    expect(contract).toContain('professionalCredential');
    expect(contract).toContain('professionalPresentation');
    expect(contract).toContain('indexSmartToken');
    expect(contract).toContain('tenantVerificationResponse');
    expect(contract).toContain('the same original professional VC');
    expect(contract).not.toContain('short-lived verification VC');
    expect(readFileSync('docs/90.A-API_INTEGRATORS_GUIDE.md', 'utf8')).not.toContain(
      'short-lived tenant VC/VP',
    );
    expect(contract).toContain('not implemented');
    expect(rootReadme).toContain(CONTRACT_PATH);
    expect(docsReadme).toContain('03.L-FEDERATED-SMART-CLEARING-HOUSE.md');
  });
});
