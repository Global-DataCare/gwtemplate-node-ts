// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/urn.ts

import { OrganizationUrnParams, EmployeeUrnParams } from "../models/tenant";

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
 * @param params An object containing the components of the URN.
 * @returns The canonical URN string for the organization.
 */
export function createOrganizationUrn(params: OrganizationUrnParams): string {
  const { namespace, network, jurisdiction, version = 'v1', sector, idType, idValue } = params;
  return `urn:${namespace}:${network}:${jurisdiction}:${version}:${sector}:entity:${idType}:${idValue}`;
}

/**
 * Creates the canonical URN for an employee, inheriting its base from the parent organization.
 * @param params An object containing the components of the URN for both the organization and the employee.
 * @returns The canonical, hierarchical URN string for the employee.
 */
export function createEmployeeUrn(params: EmployeeUrnParams): string {
  const orgUrn = createOrganizationUrn(params);
  const { email, role } = params;
  // Note: The role is expected to be the code only, e.g., "4110"
  const roleCode = role.includes(':') ? role.split(':')[1] : role;
  return `${orgUrn}:employee:email:${email}:role:isco-08:${roleCode}`;
}