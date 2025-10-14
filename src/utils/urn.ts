// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/urn.ts

import { OrganizationUrnParams, EmployeeUrnParams } from "../models/entity";

/**
 * Creates a canonical URN string from a given UUID.
 * @param uuid The UUID to format.
 * @returns The canonical URN string, e.g., 'urn:uuid:xxxxxxxx-xxxx...'.
 */
export function createUrnUuid(uuid: string): string {
    return `urn:uuid:${uuid}`;
}

/**
 * Creates the canonical URN for an organization based on its public, verifiable attributes.
 * All components of the URN are normalized to lowercase for consistency, except for the idValue.
 *
 * @param params An object containing the components of the URN.
 * @returns The canonical, normalized URN string for the organization.
 */
export function createOrganizationUrn(params: OrganizationUrnParams): string {
  const { namespace, network, jurisdiction, version = 'v1', sector, idType, idValue } = params;
  
  // Normalize all components to lowercase for canonical representation, EXCEPT for the idValue,
  // which may be case-sensitive.
  return `urn:${namespace.toLowerCase()}:${network.toLowerCase()}:${jurisdiction.toLowerCase()}:${version.toLowerCase()}:${sector.toLowerCase()}:entity:${idType.toLowerCase()}:${idValue}`;
}

/**
 * Creates the canonical URN for an employee, inheriting its base from the parent organization.
 * All components are normalized to lowercase, except for the organization's idValue.
 *
 * @param params An object containing the components of the URN for both the organization and the employee.
 * @returns The canonical, hierarchical, and normalized URN string for the employee.
 */
export function createEmployeeUrn(params: EmployeeUrnParams): string {
  const orgUrn = createOrganizationUrn(params);
  const { email, role } = params;

  // Normalize employee-specific parts to lowercase.
  // The role is split into its scheme (e.g., 'isco-08') and code, and both are lowercased.
  const roleParts = role.toLowerCase().split(':');
  const roleScheme = roleParts.length > 1 ? roleParts[0] : 'isco-08';
  const roleCode = roleParts.length > 1 ? roleParts[1] : roleParts[0];

  return `${orgUrn}:employee:email:${email.toLowerCase()}:role:${roleScheme}:${roleCode}`;
}

/**
 * Extracts the tenant's base URN from a longer, hierarchical URN.
 * The tenant URN is considered to be the part of the string up to and including the entity identifier.
 * @param fullUrn The complete, hierarchical URN (e.g., for an employee or connection).
 * @returns The base URN of the tenant, or the original string if the pattern is not found.
 */
export function getTenantIdentifierUrnPrefix(fullUrn: string): string {
  const parts = fullUrn.split(':');
  const entityIndex = parts.indexOf('entity');

  if (entityIndex === -1 || entityIndex + 2 >= parts.length) {
    // If 'entity' isn't found or there aren't enough parts for a full entity identifier,
    // we can't determine the prefix, so we might return the original URN or handle as an error.
    // For now, let's assume it might be a base URN already.
    return fullUrn;
  }

  // The prefix includes the entity identifier (3 parts: 'entity', type, value)
  const tenantParts = parts.slice(0, entityIndex + 3);
  return tenantParts.join(':');
}

/**
 * Represents the structured components of a canonical URN.
 */
export interface ParsedUrn {
  namespace: string;
  network: string;
  jurisdiction: string;
  version: string;
  sector: string;
  entityType: string; // e.g., 'entity'
  idType: string;
  idValue: string;
}

// URN format: urn:<namespace>:<network>:<jurisdiction>:<version>:<sector>:entity:<idType>:<idValue>
const URN_REGEX = /^urn:([^:]+):([^:]+):([^:]+):([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)$/;

/**
 * Parses a canonical URN string into its structured components.
 *
 * @param urn The URN string to parse.
 * @returns A ParsedUrn object, or null if the URN format is invalid.
 */
export function parseTenantUrn(urn: string): ParsedUrn | null {
  if (!urn) {
    return null;
  }

  const matches = urn.match(URN_REGEX);
  if (!matches || matches.length !== 9) {
    return null;
  }

  return {
    namespace: matches[1],
    network: matches[2],
    jurisdiction: matches[3],
    version: matches[4],
    sector: matches[5],
    entityType: matches[6],
    idType: matches[7],
    idValue: matches[8],
  };
}
