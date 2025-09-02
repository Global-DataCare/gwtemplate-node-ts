// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/resourceUtils.ts

import { v4 as uuidv4, validate as uuidValidate } from 'uuid';

/**
 * Determines a resource's ID based on an identifier claim and environment.
 * @param identifierClaim The full identifier string (e.g., 'urn:uuid:...')
 * @param environment The deployment environment (e.g., 'demo').
 * @returns The determined resource ID (either the extracted UUID, a new UUID, or the original identifier).
 */
export function determineResourceId(identifierClaim: string | undefined, environment?: string): string {
    // In 'demo' mode, we have special rules
    if (environment === 'demo' && identifierClaim) {
        // Attempt to extract a UUID first for consistency
        const uuidPart = identifierClaim.split('urn:uuid:')[1]?.split(',')[0];
        if (uuidPart && uuidValidate(uuidPart)) {
            return uuidPart;
        }
        // If not a valid UUID, return the identifier as-is
        return identifierClaim;
    }

    // In normal environments, strictly validate the UUID
    if (identifierClaim) {
        const uuidPart = identifierClaim.split('urn:uuid:')[1]?.split(',')[0];
        if (uuidPart && uuidValidate(uuidPart)) {
            return uuidPart;
        }
    }
    
    // If no identifier is provided or the validation fails, generate a new UUID.
    return uuidv4();
}
