// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('KMS deployment audit documentation', () => {
  const document = readFileSync(resolve(process.cwd(), 'docs-v1/04-DEEP-DIVES/04.H-KMS-MLKEM-RESPONSIBILITY-MATRIX.md'), 'utf8');
  const awsSection = (document.match(/### AWS deployment configuration[\s\S]*?(?=\n### |\n## )/)?.[0] ?? '')
    .replace(/\s+/g, ' ');
  const section = (document.match(/## Deployment audit: call volume, cost, and security[\s\S]*?(?=\n## )/)?.[0] ?? '')
    .replace(/\s+/g, ' ');

  it('explains temporary AWS credentials for Kubernetes hosted outside AWS', () => {
    expect(awsSection).toContain('Kubernetes hosted outside AWS');
    expect(awsSection).toContain('IAM Roles Anywhere');
    expect(awsSection).toContain('temporary credentials');
    expect(awsSection).toContain('`serve` sidecar');
    expect(awsSection).toContain('AWS_EC2_METADATA_SERVICE_ENDPOINT');
    expect(awsSection).toContain('credential_process');
    expect(awsSection).toContain('X.509');
    expect(awsSection).toContain('EKS-only mechanisms do not apply');
    expect(awsSection).toContain('must match the region of `KMS_KEY_ID`');
    expect(awsSection).toContain('does not determine the KMS key region');
    expect(awsSection).not.toContain('AWS_ACCESS_KEY_ID');
  });

  it('defines the provider-neutral external-call and qualitative cost model', () => {
    expect(section).toContain('one external encrypt operation');
    expect(section).toContain('one external decrypt operation per pod or process start');
    expect(section).toContain('Normal host and tenant business operations make no external KMS or Transit calls');
    expect(section).toContain('active root-key custody');
    expect(section).toContain('successful pod or process starts');
  });

  it('defines auditable security evidence and the bounded migration exception', () => {
    expect(section).toContain('provisioning identity');
    expect(section).toContain('runtime identity');
    expect(section).toContain('unexpected external cryptographic operations');
    expect(section).toContain('legacy direct-root envelopes');
    expect(section).toContain('restart loop');
  });

  it('does not freeze commercial prices or compare providers', () => {
    expect(section).not.toMatch(/(?:USD|EUR|\$|€|£)/);
    expect(section).not.toMatch(/cheaper|more expensive|less expensive|cheapest/i);
  });
});
