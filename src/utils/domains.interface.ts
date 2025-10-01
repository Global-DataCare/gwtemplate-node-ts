// src/utils/domains.interface.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export enum knownDomainsReversedEnum {
  'org.schema' = 'org.schema',
  'org.hl7.fhir' = 'org.hl7.fhir',
  'org.ilo.isco' = 'org.ilo.isco',
  'net.openid' = 'net.openid',
  // Add other known standards here
};

/**
 * A list of known, fully-qualified context prefixes in reverse DNS format.
 * This is used by the claim normalization utility to identify claims that
 * are already interoperable and should not be modified.
 * All entries should be in lowercase.
 */
export const knownDomainsReversed: string[] = [
  knownDomainsReversedEnum["org.schema"],
  knownDomainsReversedEnum["org.hl7.fhir"],
  knownDomainsReversedEnum["org.ilo.isco"],
  knownDomainsReversedEnum["net.openid"]
  // Add other known standards here
];
