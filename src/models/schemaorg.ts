// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/schemaorg.ts

import { ParameterData } from "./params";

export enum ClaimsServiceSchemaorg {
    category = "org.schema.Service.category",
    identifier = "org.schema.Service.identifier",
    serviceType = "org.schema.Service.serviceType",
    termsOfService = "org.schema.Service.termsOfService",
}

/**
 * Defines the canonical claim names for the 'org.schema' context,
 * based on Schema.org vocabulary.
 */
export enum ClaimsOrganizationSchemaorg {
    /** ISO 3166-1 alpha-2 (two-letter country code). The jurisdiction could be the country or the region (county, province or state) */
    addressCountry = "org.schema.Organization.address.addressCountry",
    /** ISO 3166-2 code for administrative divisions. The jurisdiction could be the country or the region (county, province or state) */
    addressRegion = "org.schema.Organization.address.addressRegion",
    addressLocality = "org.schema.Organization.address.addressLocality",
    postalCode = "org.schema.Organization.address.postalCode",
    streetAddress = "org.schema.Organization.address.streetAddress",
    /** `TAX` ID or `EI` (Employer ID): @see http://terminology.hl7.org/CodeSystem/v2-0203 */
    identifierType = "org.schema.Organization.identifier.additionalType",
    identifierValue = "org.schema.Organization.identifier.value",
    /** Legal registered name */
    legalName = "org.schema.Organization.legalName",
    /** Commercial name */
    name = "org.schema.Organization.name",
    /** short url-friendly name (0-9,a-z) */
    alternateName = "org.schema.Organization.alternateName",
    /** External URL for the service */
    url = "org.schema.Organization.url",
    /** The identifier is a URN generated using the legal ID (TAX or EI) */
    identifier = "org.schema.Organization.identifier",
    /** DUNS (free) or LEI could be provided */
    duns = "org.schema.Organization.duns",
    /** Public contact email */
    email = "org.schema.Organization.email",
    /** Public contact phone */
    telephone = "org.schema.Organization.telephone",
}

/** For Employees (and Employee Role, but no PII) and customers / related persons.
 * - `givenName`: The given name of the person.
 * - `familyName`: The primary family name or surname of the person.
 * - `alternateName`: The second surname or mother's family name, used for facilitating searches
 *   and catering to cultures with multiple surnames.
 * - `name`: The transliterated full name of the person, useful for standardized naming
 *   conventions and international contexts.
 */
export enum ClaimsPersonSchemaorg {
    /** Second surname or mother's maiden name */
    additionalName = "org.schema.Person.additionalName",
    /** Short friendly name */
    alternateName = "org.schema.Person.alternateName",
    birthDate = "org.schema.Person.birthDate",
    email = "org.schema.Person.email",
    familyName = "org.schema.Person.familyName",
    gender = "org.schema.Person.gender",
    givenName = "org.schema.Person.givenName",
    hasOccupation = "org.schema.Person.hasOccupation",
    identifier = "org.schema.Person.identifier", // the URN (composed by the provider)
    identifierType = "org.schema.Person.identifier.additionalType", // retrieved from a form
    identifierValue = "org.schema.Person.identifier.value", // retrieved from a form
    /** ICAO transliteration of official given name (including middlenames), family name and addtional surname */
    name = "org.schema.Person.name",
    telephone = "org.schema.Person.telephone",
    worksFor = "org.schema.Person.worksFor",
    /*
    gender = 'org.schema.Person.gender',
    birthDate = 'org.schema.Person.birthdate',      // Date: Date of birth.
    birthPlace = 'org.schema.Person.birthplace',    // Place: The place where the person was born.
    nationality = 'org.schema.Person.nationality',  // Country: Nationality of the person.
    height = 'org.schema.Person.height',
    // Properties from Thing
    additionalType = 'org.schema.Person.additionaltype', // e.g.: 'Employee'
    */    
}

/**
 * Defines the flat claim structure for a schema.org/Action.
 * This is used for requests where an entity (agent) performs an action,
 * often with a human controller (participant) initiating it.
 */
export enum ClaimsActionSchemaorg {
  // The primary agent performing the action (e.g., the Tenant Organization)
  agentIdentifier = 'org.schema.Action.agent.identifier',
  agentLegalName = 'org.schema.Action.agent.legalName',
  // ... other flattened properties of the agent ...

  // A co-agent participating in the action (e.g., the Human Controller T)
  participantIdentifier = 'org.schema.Action.participant.identifier',

  // The service provider or target of the action (e.g., the Fabric Network)
  providerIdentifier = 'org.schema.Action.provider.identifier',
  providerName = 'org.schema.Action.provider.name',

  // The time the action was initiated
  startTime = 'org.schema.Action.startTime',
}

export const ICAOReverseDns = 'int.icao';
export enum ICAOIdentityParams {
  HairColor = 'int.icao.mrtd.hair-color',
}

export const indexedPersonAttributeList: string[] = [
  ClaimsPersonSchemaorg.givenName,
  ClaimsPersonSchemaorg.familyName,
  ClaimsPersonSchemaorg.additionalName,
  ClaimsPersonSchemaorg.email,
  ClaimsPersonSchemaorg.telephone,
  ClaimsPersonSchemaorg.birthDate,
  ClaimsPersonSchemaorg.identifierType,
  ClaimsPersonSchemaorg.identifierValue,
  // ClaimsPersonSchemaorg.additionalType,
];

export const fullPersonParamsSchemaorg: ParameterData[] = [
  {
    name: ClaimsPersonSchemaorg.additionalName,
    type: 'string',
    value: undefined,
    unique: true,
  },
  {
    name: ClaimsPersonSchemaorg.familyName,
    type: 'string',
    value: undefined,
    unique: true,
  },
  { name: ClaimsPersonSchemaorg.email, type: 'string', value: undefined },
  {
    name: ClaimsPersonSchemaorg.givenName,
    type: 'string',
    value: undefined,
  },
  {
    name: ClaimsPersonSchemaorg.telephone,
    type: 'string',
    value: undefined,
  },
  {
    name: ClaimsPersonSchemaorg.gender,
    type: 'string',
    value: undefined,
    unique: true,
  },
  {
    name: ClaimsPersonSchemaorg.identifierType,
    type: 'string',
    value: undefined,
  },
  {
    name: ClaimsPersonSchemaorg.identifierValue,
    type: 'string',
    value: undefined,
  },
  {
    name: ClaimsPersonSchemaorg.birthDate,
    type: 'string',
    value: undefined,
    unique: true,
  },
  /*
  {
    name: ClaimsPersonSchemaorg.additionalType,
    type: 'string',
    value: undefined,
  },
  */
];
