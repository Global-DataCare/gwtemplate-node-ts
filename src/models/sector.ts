// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/sector.ts

/**
 * Defines the standardized business sectors supported by the gateway.
 * Using an enum ensures type safety and prevents the use of arbitrary strings.
 */
export enum Sector {
  HEALTH_CARE = 'health-care',
  HEALTH_INSURANCE = 'health-insurance',
  EMERGENCY = 'emergency',
  SYSTEM = 'system', // Reserved for the host's internal operations.
  TEST = "test",
}
