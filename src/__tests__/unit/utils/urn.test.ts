
import { createEmployeeUrn } from "../../../utils/urn";
import { URN_NAMESPACE, URN_VERSION } from "../../data/urn.data";

describe('createEmployeeUrn', () => {
    const baseParams = {
        namespace: URN_NAMESPACE,
        network: 'test-network' as const,
        jurisdiction: 'ES',
        version: URN_VERSION,
        sector: 'health-care',
        idType: 'vat',
        idValue: 'B12345678',
        email: 'John.Doe@Example.com',
    };

    it('should create a URN with hashed email and role code', () => {
        const params = { ...baseParams, role: '1120' };
        const urn = createEmployeeUrn(params);
        expect(urn).toMatch(/:employee:z[1-9A-HJ-NP-Za-km-z]+:role:1120$/);
    });

    it('should create a URN with explicit role scheme normalized as system|code', () => {
        const params = { ...baseParams, role: 'ISCO-08:1120' };
        const urn = createEmployeeUrn(params);
        expect(urn).toMatch(/:employee:z[1-9A-HJ-NP-Za-km-z]+:role:isco-08\|1120$/);
    });

    it('should hash email deterministically and lowercase role', () => {
        const params = { ...baseParams, role: 'ISCO-08:1120', email: 'ALICE@DOMAIN.ORG' };
        const urn = createEmployeeUrn(params);
        expect(urn).toMatch(/:employee:z[1-9A-HJ-NP-Za-km-z]+:role:isco-08\|1120$/);
        expect(urn.split(':employee:')[1].split(':role:')[0].startsWith('z')).toBe(true);
    });

    it('should handle role with only code (no scheme)', () => {
        const params = { ...baseParams, role: '9999' };
        const urn = createEmployeeUrn(params);
        expect(urn.endsWith(':role:9999')).toBe(true);
    });

    it('should handle role with custom scheme', () => {
        const params = { ...baseParams, role: 'customSCHEME:abc123' };
        const urn = createEmployeeUrn(params);
        expect(urn.endsWith(':role:customscheme|abc123')).toBe(true);
    });
});
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
