// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/params.ts

/**
 * The flat, simple parameters required to register a new tenant
 * using the old TenantManager logic.
 */
export interface SchemaorgOrganizationParam {
  legalName: string;
  additionalType: string;
  domain: string;
  identifier: string; // e.g., 'taxID|B12345678'
  addressCountry: string;
  email: string;
}
