import type {
  ServerProfileEnrollmentInput,
  ServerProfileRecord,
  ServerProfileSessionManager,
} from 'gdc-sdk-node-ts';

/**
 * Enroll one protected profile through the public SDK facade.
 *
 * The SDK owns activation exchange, secure transport and device registration.
 * The BFF supplies authenticated, typed application input and stores the
 * returned profile according to its own session policy.
 */
export async function enrollProtectedProfile(
  profileSessions: ServerProfileSessionManager,
  enrollment: ServerProfileEnrollmentInput,
): Promise<ServerProfileRecord> {
  return profileSessions.enroll(enrollment);
}

