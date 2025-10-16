// src/models/fhir/AppointmentResponse.claims.ts

/**
 * Defines the flat claims structure for a FHIR AppointmentResponse resource.
 * 
 * @basedon https://www.hl7.org/fhir/appointmentresponse.html
 */

/**
 * Contains claims representing fields specific to the FHIR R4 data model for an AppointmentResponse.
 * Use this when constructing the `credentialSubject` of a Verifiable Credential or the `resource` object.
 * 
 * @basedon https://www.hl7.org/fhir/R4/appointmentresponse.html
 */
export const AppointmentResponseClaimsFhirR4 = {
  'org.hl7.fhir.r4.core.AppointmentResponse.identifier': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.appointment': String, // Reference to Appointment
  'org.hl7.fhir.r4.core.AppointmentResponse.start': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.end': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.participant-type': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.actor': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.participant-status': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.comment': String,
  'org.hl7.fhir.r4.core.AppointmentResponse.resource.id': String,
};

/**
 * Contains claims representing the standard, version-agnostic API search parameters for an AppointmentResponse.
 * 
 * @basedon https://www.hl7.org/fhir/appointmentresponse.html#search
 */
export const AppointmentResponseClaimsFhirApi = {
  'org.hl7.fhir.api.AppointmentResponse.actor': String,
  'org.hl7.fhir.api.AppointmentResponse.appointment': String,
  'org.hl7.fhir.api.AppointmentResponse.identifier': String,
  'org.hl7.fhir.api.AppointmentResponse.location': String,
  'org.hl7.fhir.api.AppointmentResponse.part-status': String,
  'org.hl7.fhir.api.AppointmentResponse.patient': String,
  'org.hl7.fhir.api.AppointmentResponse.practitioner': String,
};

/**
 * Extends the standard API search parameters with custom parameters derived from core data model fields.
 * In this case, there are no common extended parameters, so it mirrors the base API claims.
 */
export const AppointmentResponseClaimsFhirApiExtended = {
  ...AppointmentResponseClaimsFhirApi,
  // No additional extended claims for AppointmentResponse at this time.
};
