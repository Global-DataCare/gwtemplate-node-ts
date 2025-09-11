// File: src/__tests__/unit/utils/claims.test.ts

import { processResponseModesClaim } from '../../../utils/claims';

describe('processResponseModesClaim', () => {
  const propertyId = 'net.openid.connect.discovery.response_modes_supported';

  // Test Case 1: Claim is not provided (undefined)
  test('should return the default mode when the claim is undefined', () => {
    const expected = `${propertyId}|form_post.jwt`;
    expect(processResponseModesClaim(undefined)).toBe(expected);
  });

  // Test Case 2: Claim is an empty string
  test('should return the default mode when the claim value is empty', () => {
    const claim = `${propertyId}|`;
    const expected = `${propertyId}|form_post.jwt`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 3: Claim provides a single, valid legacy mode
  test('should add the default mode and order it first', () => {
    const claim = `${propertyId}|fhir+json`;
    const expected = `${propertyId}|form_post.jwt,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 4: Claim provides multiple supported modes in the wrong order
  test('should reorder the modes to ensure form_post.jwt is first', () => {
    const claim = `${propertyId}|json,form_post.jwt,fhir+json`;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 5: Claim includes unsupported modes
  test('should strip unsupported modes from the final claim', () => {
    const claim = `${propertyId}|xml,json,invalid,fhir+json`;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 6: Claim already includes the default mode
  test('should not add a duplicate default mode', () => {
    const claim = `${propertyId}|form_post.jwt,json`;
    const expected = `${propertyId}|form_post.jwt,json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 7: Malformed claim with no pipe separator
  test('should return the default mode for a malformed claim', () => {
    const claim = 'a-malformed-claim-string';
    const expected = `${propertyId}|form_post.jwt`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 8: Claim includes duplicate valid modes
  test('should remove duplicate valid modes', () => {
    const claim = `${propertyId}|json,fhir+json,json,form_post.jwt`;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

  // Test Case 9: Claim includes extra whitespace
  test('should handle leading/trailing whitespace around modes', () => {
    const claim = ` ${propertyId} |  json ,  fhir+json  `;
    const expected = `${propertyId}|form_post.jwt,json,fhir+json`;
    expect(processResponseModesClaim(claim)).toBe(expected);
  });

});
