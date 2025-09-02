// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/host.ts

import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from "../models/schemaorg";
import { ClaimRecord } from "../__tests__/data/organization.data";
import { HostEnvVars } from "../models/env";

// Define which environment variables are strictly required to build the host claims.
// We use the enum to ensure this list is always in sync with the model.
const REQUIRED_CLAIM_VARS: HostEnvVars[] = [
    HostEnvVars.LEGAL_NAME,
    HostEnvVars.JURISDICTION,
    HostEnvVars.ID_TYPE,
    HostEnvVars.ID_VALUE,
    HostEnvVars.ADMIN_EMAIL,
    HostEnvVars.ADMIN_ROLE,
    HostEnvVars.ADMIN_UID,
    HostEnvVars.TERMS_URL,
];

/**
 * Creates a valid claims object for the host organization using environment variables.
 * @returns {ClaimRecord} The generated claims object for the host.
 * @throws {Error} If a required environment variable is not set.
 */
export function createHostClaimsFromEnv(): ClaimRecord {
    // Validate that all required variables are present
    for (const varName of REQUIRED_CLAIM_VARS) {
        if (!process.env[varName]) {
            throw new Error(`Missing required environment variable for host setup: ${varName}`);
        }
    }

    // Build the claims object using the enum for type-safe access
    const claims: ClaimRecord = {
        "@context": "org.schema",
        "@type": "template",
        
        // --- Organization Claims ---
        [ClaimsOrgSchemaorg.legalName]: process.env[HostEnvVars.LEGAL_NAME],
        [ClaimsOrgSchemaorg.addressCountry]: process.env[HostEnvVars.JURISDICTION],
        // The taxID claim is constructed from two env vars, as per your spec
        [ClaimsOrgSchemaorg.taxID]: `${process.env[HostEnvVars.ID_VALUE]}`,
        [ClaimsOrgSchemaorg.alternateName]: "host", // Hardcoded as per system design
        [ClaimsOrgSchemaorg.duns]: process.env[HostEnvVars.DUNS], // Optional, will be undefined if not set

        // --- Person (Admin) Claims ---
        [ClaimsPersonSchemaorg.email]: process.env[HostEnvVars.ADMIN_EMAIL],
        [ClaimsPersonSchemaorg.hasOccupation]: process.env[HostEnvVars.ADMIN_ROLE],
        [ClaimsPersonSchemaorg.identifier]: `urn:uuid:${process.env[HostEnvVars.ADMIN_UID]}`,

        // --- Service Claims ---
        // These are just examples, you might not need service claims for the host itself
        [ClaimsServiceSchemaorg.termsOfService]: process.env[HostEnvVars.TERMS_URL],
    };
    
    // Clean up optional undefined values
    if (!claims[ClaimsOrgSchemaorg.duns]) {
        delete claims[ClaimsOrgSchemaorg.duns];
    }
    
    return claims;
}
