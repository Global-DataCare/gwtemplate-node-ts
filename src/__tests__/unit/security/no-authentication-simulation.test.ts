// Flow contract: test and Test Network use the same authentication checks as production; an explicit local demo is the only profile that may simulate authentication.
import { resolveTokenVerifierFromEnv } from '../../../auth/token-verifier-registry';
import { federateOidcIdTokenToFirebaseCustomToken } from '../../../auth/OidcFederationService';
import { DefaultTrustRegistryAdapter } from '../../../adapters/trust-registry.adapter';
import { DemoKmsService } from '../../../services/DemoKmsService';
import { DemoTokenVerifier } from '../../../auth/DemoTokenVerifier';
import { isLocalDemoSecurityMode } from '../../../security/runtime-security-policy';

describe('no authentication simulation in gateway runtime', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it('rejects the demo authentication selector in Test Network', () => {
    process.env.AUTH_TOKEN_VERIFIER = 'demo'; process.env.SECURITY_MODE = 'demo'; process.env.NETWORK_MODE = 'test-network'; expect(() => resolveTokenVerifierFromEnv(true)).toThrow(/unsupported|disabled/i);
  });
  it('does not select a decode-only verifier merely because this is a test', () => {
    delete process.env.AUTH_TOKEN_VERIFIER; expect(resolveTokenVerifierFromEnv(true).constructor.name).toBe('FirebaseTokenVerifier');
  });
  it('does not federate an unverified identity when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test'; process.env.NETWORK_MODE = 'test-network'; delete process.env.EIDAS_ISSUER;
    await expect(federateOidcIdTokenToFirebaseCustomToken({ provider: 'eidas', idToken: 'not-a-signed-identity' })).rejects.toThrow();
  });
  it.each(['test', 'test-network', 'network'] as const)('does not invent registry checks from the %s label', async networkMode => {
    process.env.SECURITY_MODE = 'strict';
    await expect(new DefaultTrustRegistryAdapter().verifyActivationTrust({ networkMode, organizationDid: 'did:web:untrusted.example' })).rejects.toThrow(/configured|evidence|verif/i);
  });
  it.each(['test', 'test-network', 'network'])('local/test selection alone does not enable demo for %s', networkMode => {
    process.env.NODE_ENV = 'test'; process.env.NETWORK_MODE = networkMode; delete process.env.SECURITY_MODE;
    expect(isLocalDemoSecurityMode()).toBe(false);
  });
  it('rejects simulated key custody outside explicit local demo', () => { process.env.NODE_ENV = 'demo'; process.env.SECURITY_MODE = 'compat'; process.env.NETWORK_MODE = 'test-network'; expect(() => new DemoKmsService({} as any)).toThrow(/demo/i); });
  it('permits decode-only authentication only in the explicitly selected local demo profile', async () => {
    process.env.NODE_ENV = 'demo'; process.env.SECURITY_MODE = 'demo'; process.env.NETWORK_MODE = 'test'; delete process.env.DEPLOYMENT_ENV;
    expect(isLocalDemoSecurityMode()).toBe(true);
    const token = 'e30.' + Buffer.from(JSON.stringify({ sub: 'local-demo-person' })).toString('base64url') + '.demo';
    expect((await new DemoTokenVerifier().verify(token)).valid).toBe(true);
    process.env.NETWORK_MODE = 'test-network';
    expect((await new DemoTokenVerifier().verify(token)).valid).toBe(false);
  });
});
