// src/models/fhir/Appointment.claims.ts

/**
 * Defines the flat claims structure for a FHIR Appointment resource, separating
 * version-specific data model fields from version-agnostic API search parameters.
 * 
 * This model aligns with FHIR R5 conventions (using `note.text` instead of `comment`)
 * for forward compatibility and consistency with other resources like Communication.
 * 
 * @basedon https://github.com/Universal-Health-Chain/uhc-fhir-utils-typescript/blob/main/src/models/templates/Appointment.template.model.ts
 */

/**
 * Contains claims representing fields specific to the FHIR R4/R5 data model for an Appointment.
 * Use this when constructing the `credentialSubject` of a Verifiable Credential or the `resource` object.
 * 
 * @basedon https://www.hl7.org/fhir/R4/appointment.html
 */
export const AppointmentClaimsFhirR4 = {
  'org.hl7.fhir.r4.core.Appointment.identifier': String,
  'org.hl7.fhir.r4.core.Appointment.status': String,
  'org.hl7.fhir.r4.core.Appointment.cancelation-reason': String,
  'org.hl7.fhir.r4.core.Appointment.service-category': String,
  'org.hl7.fhir.r4.core.Appointment.service-type': String,
  'org.hl7.fhir.r4.core.Appointment.specialty': String,
  'org.hl7.fhir.r4.core.Appointment.appointment-type': String,
  'org.hl7.fhir.r4.core.Appointment.reason-code': String,
  'org.hl7.fhir.r4.core.Appointment.reason-reference': String,
  'org.hl7.fhir.r4.core.Appointment.priority': Number,
  'org.hl7.fhir.r4.core.Appointment.description': String,
  'org.hl7.fhir.r4.core.Appointment.supporting-information': String,
  'org.hl7.fhir.r4.core.Appointment.start': String,
  'org.hl7.fhir.r4.core.Appointment.end': String,
  'org.hl7.fhir.r4.core.Appointment.minutes-duration': Number,
  'org.hl7.fhir.r4.core.Appointment.slot': String,
  'org.hl7.fhir.r4.core.Appointment.created': String,
  // 'org.hl7.fhir.r4.core.Appointment.comment': String, // Deprecated in R5, using note.text for forward compatibility
  'org.hl7.fhir.r4.core.Appointment.note.text': String, 
  'org.hl7.fhir.r4.core.Appointment.patient-instruction': String,
  'org.hl7.fhir.r4.core.Appointment.based-on': String,
  'org.hl7.fhir.r4.core.Appointment.participant.actor': String,
  'org.hl7.fhir.r4.core.Appointment.participant.required': String,
  'org.hl7.fhir.r4.core.Appointment.participant.status': String,
  'org.hl7.fhir.r4.core.Appointment.participant.type': String,
  'org.hl7.fhir.r4.core.Appointment.requested-period': String,
  'org.hl7.fhir.r4.core.Appointment.resource.id': String,
};

/**
 * Contains claims representing the standard, version-agnostic API search parameters for an Appointment.
 * 
 * @basedon https://www.hl7.org/fhir/appointment.html#search
 */
export const AppointmentClaimsFhirApi = {
  'org.hl7.fhir.api.Appointment.actor': String,
  'org.hl7.fhir.api.Appointment.appointment-type': String,
  'org.hl7.fhir.api.Appointment.based-on': String,
  'org.hl7.fhir.api.Appointment.date': String,
  'org.hl7.fhir.api.Appointment.identifier': String,
  'org.hl7.fhir.api.Appointment.location': String,
  'org.hl7.fhir.api.Appointment.part-status': String,
  'org.hl7.fhir.api.Appointment.patient': String,
  'org.hl7.fhir.api.Appointment.practitioner': String,
  'org.hl7.fhir.api.Appointment.reason-code': String,
  'org.hl7.fhir.api.Appointment.reason-reference': String,
  'org.hl7.fhir.api.Appointment.service-category': String,
  'org.hl7.fhir.api.Appointment.service-type': String,
  'org.hl7.fhir.api.Appointment.slot': String,
  'org.hl7.fhir.api.Appointment.specialty': String,
  'org.hl7.fhir.api.Appointment.status': String,
  'org.hl7.fhir.api.Appointment.supporting-info': String,
};

/**
 * Extends the standard API search parameters with custom parameters derived from core data model fields.
 */
export const AppointmentClaimsFhirApiExtended = {
  ...AppointmentClaimsFhirApi,
  'org.hl7.fhir.api.Appointment.cancelation-reason': String,
  'org.hl7.fhir.api.Appointment.minutes-duration': Number,
  'org.hl7.fhir.api.Appointment.priority': Number,
  'org.hl7.fhir.api.Appointment.created': String,
  'org.hl7.fhir.api.Appointment.description': String,
  'org.hl7.fhir.api.Appointment.note-text': String, // Instead of 'comment', which is deprecated in R5
};
