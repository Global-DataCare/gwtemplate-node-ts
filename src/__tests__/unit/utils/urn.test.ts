// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/urn.test.ts

import { createUrnFromUuid } from "../../../utils/urn";


describe('createUrnFromUuid', () => {
    it('should correctly format a UUID into a URN string', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
        const expectedUrn = 'urn:uuid:a1b2c3d4-e5f6-7890-1234-567890abcdef';
        expect(createUrnFromUuid(uuid)).toBe(expectedUrn);
    });

    it('should handle an empty string', () => {
        expect(createUrnFromUuid('')).toBe('urn:uuid:');
    });
});
