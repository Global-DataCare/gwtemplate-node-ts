// File: src/__tests__/unit/utils/tenant.test.ts

import { isValidTenantAlternateName } from '../../../utils/tenant';

describe('isValidTenantAlternateName', () => {

  // Test Case 1: A valid alternateName
  test('should return true for a valid, non-conflicting alternateName', () => {
    expect(isValidTenantAlternateName('my-tenant')).toBe(true);
  });

  // Test Case 2: The exact word "host" (lowercase)
  test('should return false for the exact word "host"', () => {
    expect(isValidTenantAlternateName('host')).toBe(false);
  });

  // Test Case 3: The word "host" in a different case
  test('should return false for "Host" regardless of case', () => {
    expect(isValidTenantAlternateName('Host')).toBe(false);
    expect(isValidTenantAlternateName('HOST')).toBe(false);
  });

  // Test Case 4: A name starting with "host"
  test('should return false for names starting with "host"', () => {
    expect(isValidTenantAlternateName('hostname')).toBe(false);
    expect(isValidTenantAlternateName('host-tenant')).toBe(false);
  });

  // Test Case 5: A name ending with "host"
  test('should return false for names ending with "host"', () => {
    expect(isValidTenantAlternateName('myhost')).toBe(false);
    expect(isValidTenantAlternateName('tenant-host')).toBe(false);
  });

  // Test Case 6: An empty string
  test('should return false for an empty string', () => {
    expect(isValidTenantAlternateName('')).toBe(false);
  });

  // Test Case 7: A valid name that contains "host" but doesn't start or end with it
  test('should return true for a name containing "host" in the middle', () => {
    // This test assumes the logic is only concerned with prefixes and suffixes.
    // Depending on the desired strictness, this test might need to change.
    // For now, it reflects the current implementation.
    expect(isValidTenantAlternateName('my-host-app')).toBe(true);
  });
});
