// TDD contract: write this test red first; make it green only with the complete real behavior.
// src/__tests__/data/urn.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Centralized constants for building semantic URNs in tests.
 * This ensures consistency and alignment with the architecture.
 */
export const URN_NAMESPACE = 'unid';
export const URN_NETWORK = 'test-network';
export const URN_VERSION = 'v1';
/** Reusable organization identifier segment for canonical test URNs. */
export const URN_ORGANIZATION_ID_TYPE = 'tax';
