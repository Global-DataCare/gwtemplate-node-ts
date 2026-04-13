
/** Test Claims for subject organization registration payload (SUBJECTORG) */
export const testSubjectOrgRegisterExpanded = {
  "org.schema.Organization.address.addressCountry": "ES",
  "org.schema.Organization.identifier": "urn:uuid:<uuid-1>",
  "org.schema.Organization.name": "Smith Family",
  "org.schema.Organization.additionalType": "CareTeam",
  "org.schema.Organization.owner.email": "alice@example.com",
  "org.schema.Organization.owner.identifier": "did:web:alice.example.com",
  "org.schema.Person.email": "bob@example.com",
  "org.schema.Person.hasOccupation": "org.hl7.v3.RoleCode|RESPRSN",
  "org.schema.Service.identifier": "did:web:api-provider.example.com",
  "org.schema.Service.category": "health-care",
  "org.schema.Service.termsOfService": "https://provider.example.com/terms.pdf",
};

/** Backwards compatibility alias for existing tests */
export const testFamilyRegisterExpanded = testSubjectOrgRegisterExpanded;
