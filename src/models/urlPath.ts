// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/urlPath.ts

/**
 * Defines the standardized business sectors supported by the gateway.
 * Using an enum ensures type safety and prevents the use of arbitrary strings.
 */
export enum Sector {
  HOST = 'host', // Reserved for the host's bootstrap operation and database collection name.
  SYSTEM = 'system', // Reserved for the host's bootstrap operation (TODO: deprecate)
  TEST = 'test', // For dummy endpoints
  HEALTH_CARE = 'health-care',
  HEALTH_INSURANCE = 'health-insurance',
  EMERGENCY = 'emergency',
  RESEARCH = 'research',
}

export enum Section {
  /** Managing registration of organizations */
  registry = 'registry',
  /** Managing data of the hosted organization */
  entity = 'entity',
  /** Managing data of the hosted individual */
  individual = 'individual',
  /** Managing data in the blockchain network */
  network = 'network', // generic 'network' for the path, but customized network name can be used
}

/** Standards, specifications and formats for data supported in the url path */
export enum Format {
  Schema = 'org.schema',
  FhirApi = 'org.hl7.fhir.api',
  //Pdf' = 'pdf',
}

/** Types of resources supported in the url path */
export enum Resource {
  Person = 'Person',
  RelatedPerson = 'RelatedPerson',
  Employee = 'Emloyee',
  EmployeeRole = 'EmloyeeRole',
  Practitioner = 'Practitioner',
  PractitionerRole = 'PractitionerRole',
  Organization = 'Organization',
  Location = 'Location',
  Group = 'Group',
}

export enum JobAction {
  "_batch" = "_batch",
  "_create" = "_create",
  "_discovery" = "_discovery"
}

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
