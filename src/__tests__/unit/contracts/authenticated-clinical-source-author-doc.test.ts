// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * 1. A BFF selects owner-authored or registered-creator-authored content.
 * 2. GW receives ordinary FHIR author/attester references plus independent audit evidence.
 * 3. Same-owner members and authorized professionals may correct a version.
 * 4. The SC writes each CID as its own asset in one data[] transaction and GW returns that transaction id.
 * Authorization invariant: UI references, DIDComm sender and signing kid cannot select provenance.
 * Persistence invariant: old versions remain; delete stays author-only; member/professional
 * creator assignments may be both author and attester.
 */
import { readFileSync } from 'node:fs';

const guide = readFileSync(
  'docs/01-OVERVIEW-AND-GUIDES/101-01.N-AUTHENTICATED-CLINICAL-AUTHOR.md',
  'utf8',
);
const snippet = readFileSync(
  'docs/01-OVERVIEW-AND-GUIDES/snippets/authenticated-clinical-data.ts',
  'utf8',
);
const readme = readFileSync('README.md', 'utf8');
const releaseSkill = readFileSync('.codex/skills/enforce-release-test-discipline/SKILL.md', 'utf8');
const provenanceSkill = readFileSync('.codex/skills/govern-digital-twin-consent/SKILL.md', 'utf8');

describe('authenticated clinical source-author documentation', () => {
  it('documents both personal and professional owner-or-creator cases', () => {
    expect(guide).toContain('ClinicalSourceAuthorSelections.Owner');
    expect(guide).toContain('ClinicalSourceAuthorSelections.Creator');
    expect(guide).toMatch(/RelatedPerson[\s\S]*both author and attester/i);
    expect(guide).toMatch(/PractitionerRole[\s\S]*both author and attester/i);
    expect(guide).toMatch(/member[\s\S]*dictated[\s\S]*individual[\s\S]*author/i);
    expect(guide).toMatch(/actorDid[\s\S]*transport[\s\S]*not[\s\S]*author/i);
    expect(guide).toMatch(/same individual[\s\S]*corrected version/i);
    expect(guide).toMatch(/professional assignment[\s\S]*correct personal content/i);
    expect(guide).toMatch(/data\[\][\s\S]*evidence entry[\s\S]*transaction id/i);
    expect(guide).toMatch(/CID[\s\S]*individual `assetId`/i);
    expect(guide).toMatch(/`fullUrl`[\s\S]*do not enter the ledger/i);
  });

  it('keeps snippets, README and repository skills linked to the same contract', () => {
    expect(snippet).toContain('ClinicalSourceAuthorSelection');
    expect(snippet).toContain('sourceAuthor');
    expect(guide).toContain('gdc-sdk-node-ts/blob/main/docs/101-BFF_CLINICAL_WRITES.md');
    expect(readme).toMatch(/Composition[\s\S]*author[\s\S]*attester/i);
    expect(readme).toContain('101-01.N-AUTHENTICATED-CLINICAL-AUTHOR.md');
    expect(releaseSkill).toContain('owner | creator');
    expect(provenanceSkill).toContain('owner | creator');
  });
});
