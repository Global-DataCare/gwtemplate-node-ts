// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/urn.ts

/**
 * Creates a canonical URN string from a given UUID.
 * @param uuid The UUID to format.
 * @returns The canonical URN string, e.g., 'urn:uuid:xxxxxxxx-xxxx...'.
 */
export function createUrnFromUuid(uuid: string): string {
    return `urn:uuid:${uuid}`;
}
