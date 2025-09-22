// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/confidential-storage.ts

import { RecordBase } from "./resource-document";

/**
 * Defines the structure of an attribute to be indexed for blind, searchable queries.
 * @see https://identity.foundation/confidential-storage/#indexed-attributes
 */
export interface IndexedAttribute {
    name: string;
    value: string;
    unique?: boolean;
}

/**
 * Defines an indexed portion of a confidential document, allowing specific attributes to be searchable.
 */
export interface IndexedData {
    attributes: IndexedAttribute[];
    hmac?: {
        id: string;
        type: string;
    };
    sequence?: number;
}

/**
 * Represents a complete Structured Document as defined by the Confidential Storage specification.
 * This is the canonical format for all documents persisted in a vault.
 * @see https://identity.foundation/confidential-storage/#structureddocument
 */
export interface ConfidentialStorageDoc extends RecordBase {
    // 'id' is inherited from RecordBase
    
    /** A number that MUST be incremented each time the document is updated. */
    sequence: number;

    /** An array of objects that contain indexed attributes for blind queries. */
    indexed?: IndexedData[];
    
    /** The main, potentially encrypted, content of the document. */
    content?: Record<string, any>;

    /** The JWE representation of the encrypted content. */
    jwe?: Record<string, any>;

    /** Metadata about the document. */
    meta?: {
        created?: string;
        contentType?: string;
        chunks?: number;
    };
}

/**
 * Represents a document whose sensitive content has been decrypted and is held
 * in memory. The `jwe` property is removed, and the `content` is guaranteed to exist.
 * This type should ONLY be used for in-memory processing and NEVER for persistence.
 * @template T The expected type of the decrypted `content`.
 */
export type UnprotectedStorageDoc<T> = Omit<ConfidentialStorageDoc, 'jwe' | 'content'> & {
    content: T;
};