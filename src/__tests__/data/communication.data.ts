// TDD contract: write this test red first; make it green only with the complete real behavior.
// File: src/__tests__/data/communication.data.ts
//
// Convenience re-exports for Communication-related fixtures.
// The canonical source remains `appointment.data.ts` to preserve existing imports.

export {
  testCommunicationAppointmentFhirR4,
  testCalendarICS,
  testCalendarICSBase64,
  testAppointmentSourceUrl,
  testAppointmentSentDateTime,
  testAppointmentSentEpochTime,
  testAppointmentRequestText,
} from './appointment.data';

