// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/urn.test.ts

import { createUrnUuid } from "../../../utils/urn";


describe('createUrnFromUuid', () => {
    it('should correctly format a UUID into a URN string', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
        const expectedUrn = 'urn:uuid:a1b2c3d4-e5f6-7890-1234-567890abcdef';
        expect(createUrnUuid(uuid)).toBe(expectedUrn);
    });

    it('should handle an empty string', () => {
        expect(createUrnUuid('')).toBe('urn:uuid:');
    });

    it('should still format a non-UUID string correctly', () => {
      const notUuid = 'this-is-not-a-uuid';
      const expectedUrn = 'urn:uuid:this-is-not-a-uuid';
      expect(createUrnUuid(notUuid)).toBe(expectedUrn);
    });
});
