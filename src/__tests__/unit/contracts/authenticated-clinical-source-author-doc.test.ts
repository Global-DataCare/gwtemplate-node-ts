// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * 1. A BFF loads one protected creator export; the browser selects no identity.
 * 2. GW receives ordinary FHIR author/attester references plus independent audit evidence.
 * 3. Same-owner members and authorized professionals may correct a version.
 * 4. The SC writes each CID plus opaque provenance links as its own asset in one data[] transaction and GW returns that transaction id.
 * Authorization invariant: UI references, DIDComm sender and signing kid cannot select provenance.
 * Persistence invariant: old versions remain; delete stays author-only; member/professional
 * RelatedPerson assignments may be both author and attester; professionals
 * keep the CDS legal-organization author plus PractitionerRole attester.
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
const ledgerSchema = readFileSync('docs-v2/28-clinical-employee-ledger-schema.md', 'utf8');

describe('authenticated clinical source-author documentation', () => {
  it('documents the personal and professional protected-provenance cases', () => {
    expect(guide).toContain('ClinicalSourceAuthorSelections.Owner | Creator');
    expect(guide).toMatch(/RelatedPerson[\s\S]*both author and attester/i);
    expect(guide).toMatch(/professional[\s\S]*legal organization URN[\s\S]*PractitionerRole/i);
    expect(guide).toContain('urn:cds-es:v1:organization:tax:ES-B00112233');
    expect(guide).toMatch(/urn:cds-es:v1:organization:tax:ES-B00112233:member:.*ISCO-08\|2211/);
    expect(guide).toMatch(/did:web:api\.acme\.org:employee:.*ISCO-08\|2211/i);
    expect(guide).toMatch(/individual:UUID:.*:member:.*:RESPRSN/i);
    expect(guide).toMatch(/member[\s\S]*dictated[\s\S]*individual[\s\S]*author/i);
    expect(guide).toMatch(/actorDid[\s\S]*transport[\s\S]*not[\s\S]*author/i);
    expect(guide).toMatch(/same individual[\s\S]*corrected version/i);
    expect(guide).toMatch(/professional assignment[\s\S]*correct personal content/i);
    expect(guide).toMatch(/data\[\][\s\S]*evidence entry[\s\S]*transaction id/i);
    expect(guide).toMatch(/CID[\s\S]*individual `assetId`/i);
    expect(guide).toMatch(/relationships[\s\S]*ownerships[\s\S]*SHA3-384 multihashes/i);
    expect(guide).toMatch(/UUID[\s\S]*16 bytes[\s\S]*employee/i);
    expect(guide).toMatch(/`fullUrl`[\s\S]*raw identities[\s\S]*do\s+not enter the ledger/i);
  });

  it('keeps snippets, README and repository skills linked to the same contract', () => {
    expect(snippet).toContain('ClinicalSourceAuthorSelection');
    expect(snippet).toContain('sourceAuthor');
    expect(snippet).toContain('clinicalCreator: input.clinicalCreator');
    expect(guide).toContain('gdc-sdk-node-ts/blob/main/docs/101-BFF_CLINICAL_WRITES.md');
    expect(readme).toMatch(/Composition[\s\S]*author[\s\S]*attester/i);
    expect(readme).toContain('101-01.N-AUTHENTICATED-CLINICAL-AUTHOR.md');
    expect(releaseSkill).toContain('CDS legal-organization URN');
    expect(releaseSkill).toContain('relationships`/`ownerships');
    expect(provenanceSkill).toMatch(/CDS\s+legal-organization URN/);
    expect(ledgerSchema).toMatch(/employee-sc[\s\S]*subjectkeybinding-sc[\s\S]*cryptographickey-sc/i);
    expect(ledgerSchema).toMatch(/UUID[\s\S]*16 bytes[\s\S]*SHA3-384[\s\S]*multihash/i);
    expect(ledgerSchema).toMatch(/role[\s\S]*validFrom[\s\S]*validUntil[\s\S]*history/i);
    expect(ledgerSchema).toMatch(/roleLicenseId[\s\S]*keyId[\s\S]*kid/i);
  });
});
