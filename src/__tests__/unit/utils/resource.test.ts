// Flow contract: resource identifiers preserve valid UUIDs and generate replacements only under the documented rules.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/resource.test.ts

import { jest } from '@jest/globals';

const uuidv4 = jest.fn();
const uuidValidate = jest.fn();

jest.unstable_mockModule('uuid', () => ({
    v4: uuidv4,
    validate: uuidValidate,
}));

const { determineResourceId } = await import('../../../utils/resource');

describe('determineResourceId', () => {
    const validUuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    const validIdentifier = `urn:uuid:${validUuid}`;
    const nonUuidIdentifier = 'user-123';
    
    beforeEach(() => {
        // Reset mocks before each test
        uuidv4.mockReset();
        uuidValidate.mockReset();
    });

    it('should return the UUID from a valid identifier', () => {
        uuidValidate.mockReturnValue(true);
        const resourceId = determineResourceId(validIdentifier);
        expect(resourceId).toBe(validUuid);
        expect(uuidv4).not.toHaveBeenCalled();
    });

    it("should generate a new UUID if the identifier is invalid", () => {
        uuidValidate.mockReturnValue(false);
        uuidv4.mockReturnValue('new-generated-uuid');
        const resourceId = determineResourceId('invalid-identifier');
        expect(resourceId).toBe('new-generated-uuid');
        expect(uuidv4).toHaveBeenCalledTimes(1);
    });

    it("should generate a new UUID if no identifier is provided", () => {
        uuidv4.mockReturnValue('new-generated-uuid');
        const resourceId = determineResourceId(undefined);
        expect(resourceId).toBe('new-generated-uuid');
        expect(uuidv4).toHaveBeenCalledTimes(1);
    });

    it("should return the non-UUID identifier directly when in 'demo' mode", () => {
        const resourceId = determineResourceId(nonUuidIdentifier, 'demo');
        expect(resourceId).toBe(nonUuidIdentifier);
        expect(uuidValidate).not.toHaveBeenCalled();
        expect(uuidv4).not.toHaveBeenCalled();
    });

    it("should still extract a valid UUID even in 'demo' mode if provided", () => {
        uuidValidate.mockReturnValue(true);
        const resourceId = determineResourceId(validIdentifier, 'demo');
        expect(resourceId).toBe(validUuid);
    });

    it("should extract the UUID from a complex identifier string containing a comma", () => {
        uuidValidate.mockReturnValue(true);
        const complexIdentifier = `urn:uuid:${validUuid},did:web:some-controller`;
        const resourceId = determineResourceId(complexIdentifier);
        expect(resourceId).toBe(validUuid);
        expect(uuidv4).not.toHaveBeenCalled();
    });
});
