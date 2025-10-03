// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/schemaorg.ts

import { ParameterData } from "./params";

/**
 * Defines the canonical claim names for the 'org.schema' context,
 * based on Schema.org vocabulary.
 */
export enum ClaimsOrgSchemaorg {
  addressCountry = "org.schema.Organization.address.addressCountry",
  addressRegion = "org.schema.Organization.address.addressRegion",
  addressLocality = "org.schema.Organization.address.addressLocality",
  postalCode = "org.schema.Organization.address.postalCode",
  streetAddress = "org.schema.Organization.address.streetAddress",
  alternateName = "org.schema.Organization.alternateName",
  duns = "org.schema.Organization.duns",
  email = "org.schema.Organization.email",
  identifier = "org.schema.Organization.identifier", // the URN (composed by the provider)
  identifierType = "org.schema.Organization.identifier.additionalType", // retrieved from a form
  identifierValue = "org.schema.Organization.identifier.value", // retrieved from a form
  legalName = "org.schema.Organization.legalName",
  // taxID = "org.schema.Organization.taxID",
  telephone = "org.schema.Organization.telephone",
  url = "org.schema.Organization.url",
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
    additionalName = "org.schema.Person.additionalName",
    birthDate = "org.schema.Person.birthDate",
    email = "org.schema.Person.email",
    familyName = "org.schema.Person.familyName",
    gender = "org.schema.Person.gender",
    givenName = "org.schema.Person.givenName",
    hasOccupation = "org.schema.Person.hasOccupation",
    identifier = "org.schema.Person.identifier", // the URN (composed by the provider)
    identifierType = "org.schema.Person.identifier.additionalType", // retrieved from a form
    identifierValue = "org.schema.Person.identifier.value", // retrieved from a form
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

export enum ClaimsServiceSchemaorg {
    category = "org.schema.Service.category",
    identifier = "org.schema.Service.identifier",
    serviceType = "org.schema.Service.serviceType",
    termsOfService = "org.schema.Service.termsOfService",
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
