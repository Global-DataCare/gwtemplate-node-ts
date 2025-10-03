// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/host.ts

import { v4 as uuidv4} from 'uuid';
import { ClaimsOrgSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from "../models/schemaorg";
import { HostEnvVars } from "../models/env";
import { JobRequest } from "../models/request";
import { ClaimsRecord } from "../models/resource-document";
import { getHostDidWebId } from "./did";

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
 * @returns {ClaimsRecord} The generated claims object for the host.
 * @throws {Error} If a required environment variable is not set.
 */
export function createHostClaimsFromEnv(): ClaimsRecord {
    // Validate that all required variables are present
    for (const varName of REQUIRED_CLAIM_VARS) {
        if (!process.env[varName]) {
            throw new Error(`Missing required environment variable for host setup: ${varName}`);
        }
    }

    // Build the claims object using the enum for type-safe access
    const claims: ClaimsRecord = {
        "@context": "org.schema",
        "@type": "template",

        // --- Organization Claims ---
        [ClaimsOrgSchemaorg.legalName]: process.env[HostEnvVars.LEGAL_NAME],
        [ClaimsOrgSchemaorg.addressCountry]: process.env[HostEnvVars.JURISDICTION],
        // The taxID claim is constructed from two env vars, as per your spec
        // [ClaimsOrgSchemaorg.taxID]: `${process.env[HostEnvVars.ID_VALUE]}`,
        [ClaimsOrgSchemaorg.alternateName]: "host", // Hardcoded as per system design
        // [ClaimsOrgSchemaorg.duns]: process.env[HostEnvVars.DUNS], // Optional, will be undefined if not set

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

/**
 * Creates a complete JobRequest object to initialize the HOST organization using environment variables.
 * This is used to bootstrap the system if the host has not been initialized.
 * @returns {JobRequest} The fully constructed job object for host initialization.
 */
export function initializeHostJobFromEnv(): JobRequest {
    const hostClaims = createHostClaimsFromEnv();

    // Construct the full JobRequest object, providing the necessary context.
    const job: JobRequest = {
        // Context derived from the host's fixed nature
        tenantId: 'host',
        jurisdiction: process.env[HostEnvVars.JURISDICTION],
        resourceType: 'Organization',
        section: 'org.schema', // The schema category
        action: '_batch', // The operation being performed

        // The core input, mimicking a decoded DIDComm message
        input: {
            thid: uuidv4(),
            aud: getHostDidWebId(),            
            type: 'https://didcomm.org/registration/1.0/register',
            body: {
                // Following the HybridPayload rule, the body contains a `data` array of `entry` objects.
                data: [{
                    meta: {
                        templateId: "HostInitializationForm",
                        templateVersion: "1.0",
                        claims: hostClaims
                    }
                }]
            }
        },
        // In a real scenario, httpMethod, fullUrl etc. would be undefined
        // as this job is generated internally, not from a direct HTTP request.
        httpMethod: 'INTERNAL',
        fullUrl: 'internal://host-initialization'
    };

    return job;
}