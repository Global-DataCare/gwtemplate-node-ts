// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Defines the canonical claim names for the 'org.schema' context,
 * based on Schema.org vocabulary.
 */

export enum ClaimsOrgSchemaorg {
    addressCountry = "org.schema.Organization.addressCountry",
    alternateName = "org.schema.Organization.alternateName",
    duns = "org.schema.Organization.duns",
    email = "org.schema.Organization.email",
    identifier = "org.schema.Organization.identifier",
    legalName = "org.schema.Organization.legalName",
    taxID = "org.schema.Organization.taxID",
    telephone = "org.schema.Organization.telephone",
    url = "org.schema.Organization.url",
}

export enum ClaimsPersonSchemaorg {
    additionalName = "org.schema.Person.additionalName",
    birthDate = "org.schema.Person.birthDate",
    email = "org.schema.Person.email",
    familyName = "org.schema.Person.familyName",
    gender = "org.schema.Person.gender",
    givenName = "org.schema.Person.givenName",
    hasOccupation = "org.schema.Person.hasOccupation",
    identifier = "org.schema.Person.identifier",
    name = "org.schema.Person.name",
    telephone = "org.schema.Person.telephone",
    worksFor = "org.schema.Person.worksFor",
}

export enum ClaimsServiceSchemaorg {
    category = "org.schema.Service.category",
    serviceType = "org.schema.Service.serviceType",
    termsOfService = "org.schema.Service.termsOfService",
}
