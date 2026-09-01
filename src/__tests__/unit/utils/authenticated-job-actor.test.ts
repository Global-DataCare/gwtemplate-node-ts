// Flow contract: a registered DCR actor is bound by an exact SMART subject DID or the same verified OIDC contact identifier embedded in its canonical professional DID; provider-local account ids and unverified contacts never become controller authority.
import { buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import { isVerifiedBearerBoundToActorDid } from '../../../utils/authenticated-job-actor';

describe('authenticated job actor binding', () => {
  const email = 'controller@example.org';
  const actorDid = buildProfessionalDidWeb({
    organizationDidWeb: 'did:web:gw.example:7654321:cds-CA-BC:v1:animal-care',
    email,
    role: 'RESPRSN',
  });

  it('binds verified contact evidence without equating the external account subject to the DID', () => {
    expect(isVerifiedBearerBoundToActorDid({
      sub: 'external-provider-account-id',
      email,
      email_verified: true,
    }, actorDid)).toBe(true);
  });

  it('rejects unverified or different contacts', () => {
    expect(isVerifiedBearerBoundToActorDid({ email, email_verified: false }, actorDid)).toBe(false);
    expect(isVerifiedBearerBoundToActorDid({
      email: 'different@example.org',
      email_verified: true,
    }, actorDid)).toBe(false);
  });
});
