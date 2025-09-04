// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/host.test.ts

import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from '../../../models/schemaorg';
import { testHostData } from '../../data/organization.data';
import { HostEnvVars } from '../../../models/env';
import { createHostClaimsFromEnv } from '../../../utils/host';

describe('createHostClaimsFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        // Mock the environment variables using the HostEnvVars enum for type safety
        process.env = {
            ...originalEnv,
            [HostEnvVars.LEGAL_NAME]: testHostData.legalName,
            [HostEnvVars.JURISDICTION]: testHostData.addressCountry,
            [HostEnvVars.ID_VALUE]: testHostData.taxId,
            [HostEnvVars.ADMIN_EMAIL]: testHostData.member.admin1.email,
            [HostEnvVars.ADMIN_ROLE]: testHostData.member.admin1.hasOccupation,
            [HostEnvVars.ADMIN_UID]: testHostData.member.admin1.uuid,
            [HostEnvVars.TERMS_URL]: testHostData.provider.service.termsOfService,
            // Add other required vars that might not be in testHostData
            [HostEnvVars.ID_TYPE]: 'TAX',
            [HostEnvVars.DB_TYPE]: 'MEMORY',
        };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('should create a valid host claims object from environment variables', () => {
        const claims = createHostClaimsFromEnv();

        expect(claims).toBeDefined();
        
        expect(claims[ClaimsOrgSchemaorg.legalName]).toBe(testHostData.legalName);
        expect(claims[ClaimsOrgSchemaorg.addressCountry]).toBe(testHostData.addressCountry);
        expect(claims[ClaimsOrgSchemaorg.taxID]).toBe(testHostData.taxId);
        expect(claims[ClaimsOrgSchemaorg.alternateName]).toBe("host");

        expect(claims[ClaimsPersonSchemaorg.email]).toBe(testHostData.member.admin1.email);
        expect(claims[ClaimsPersonSchemaorg.hasOccupation]).toBe(testHostData.member.admin1.hasOccupation);
        expect(claims[ClaimsPersonSchemaorg.identifier]).toBe(`urn:uuid:${testHostData.member.admin1.uuid}`);
    });

    it('should throw an error if a required environment variable is missing', () => {
        delete process.env[HostEnvVars.LEGAL_NAME];
        expect(() => createHostClaimsFromEnv()).toThrow(`Missing required environment variable for host setup: ${HostEnvVars.LEGAL_NAME}`);
    });
});
