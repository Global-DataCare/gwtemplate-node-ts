// src/__tests__/utils/urn-hash.test.ts
import { generateUrnHash } from '../../utils/urn-hash';
import { testExamplesIndividualUrn } from '../data/identity.data';

describe('generateUrnHash', () => {
  // This test's primary goal is to log the generated hashes for documentation.
  it('should generate deterministic, multibase-encoded hashes for all example URNs', () => {
    console.log('--- URN Multibase Hash Generation ---');

    for (const [key, urn] of Object.entries(testExamplesIndividualUrn)) {
      const hash = generateUrnHash(urn);

      // Log the input and output for documentation and verification
      console.log(`URN (${key}): ${urn}`);
      console.log(`Canonicalized: ${canonicalizeForTest(urn)}`);
      console.log(`Multibase Hash: ${hash}\n`);

      // Basic assertion to ensure the function is working
      expect(hash).toBeDefined();
      expect(hash.startsWith('z')).toBe(true);
    }

    console.log('------------------------------------');
  });

  it('should produce the same hash for URNs that only differ in schema-part casing', () => {
    // This URN has uppercase schema parts ('URN', 'NETWORK', 'IDENTIFIER', 'NNES').
    // The value parts ('global', '12345678Z') remain as is.
    const urnWithUppercaseSchema = 'URN:NETWORK:global:IDENTIFIER:NNES:12345678Z';
    
    // This is the reference URN from the data file.
    const referenceUrn = testExamplesIndividualUrn.nnes; // 'urn:network:global:identifier:NNES:12345678Z'

    // Both URNs should canonicalize to the same string, producing the same hash.
    // Canonical form: 'urn:network:global:identifier:nnes:12345678Z'
    const expectedHash = generateUrnHash(referenceUrn);
    const actualHash = generateUrnHash(urnWithUppercaseSchema);

    expect(actualHash).toEqual(expectedHash);
  });

  it('should produce a different hash if a value-part casing differs', () => {
    // This URN has an uppercase value part ('GLOBAL').
    const urnWithUppercaseValue = 'urn:network:GLOBAL:identifier:NNES:12345678Z';
    
    // This is the reference URN from the data file, which has a lowercase 'global'.
    const referenceUrn = testExamplesIndividualUrn.nnes;

    // Because the case of the value part 'GLOBAL' is preserved, the hashes will be different.
    const expectedHash = generateUrnHash(referenceUrn);
    const actualHash = generateUrnHash(urnWithUppercaseValue);

    expect(actualHash).not.toEqual(expectedHash);
  });
});

/**
 * A helper function for logging purposes only to show what the canonicalized URN looks like.
 * This duplicates the logic from the main function for verification in the test output.
 */
function canonicalizeForTest(urn: string): string {
  const parts = urn.split(':');
  const canonicalParts = parts.map((part, index) => {
    if ((index + 1) % 3 === 0) {
      return part;
    }
    return part.toLowerCase();
  });
  return canonicalParts.join(':');
}
