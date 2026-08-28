// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import {
  buildStableActorIdentifier,
  StableActorContactKinds,
} from 'gdc-common-utils-ts/utils/actor-identifier';

/**
 * Returns the operational actor DID authenticated for one queued request.
 * Verified SMART `sub` is authoritative; signed DIDComm `iss` is the fallback.
 * Plain request claims are never read as authentication evidence here.
 */
export function getAuthenticatedJobActorDid(job: JobRequest): string | undefined {
  const bearerSubject = String((job.content as any)?.meta?.bearer?.jwt?.payload?.sub || '').trim();
  if (bearerSubject.startsWith('did:web:')) return bearerSubject;
  const signedIssuer = String(job.content?.iss || '').trim();
  return signedIssuer.startsWith('did:web:') ? signedIssuer : undefined;
}

/**
 * Returns privacy-preserving identifiers proven by the authenticated request.
 * A linked account token can carry both its verified email and phone, allowing
 * a later login channel to match data authored through the other channel.
 */
export function getAuthenticatedJobActorIdentifiers(job: JobRequest): string[] {
  const payload = (job.content as any)?.meta?.bearer?.jwt?.payload as Record<string, any> | undefined;
  const identifiers = new Set<string>();
  const actorDid = getAuthenticatedJobActorDid(job);
  if (actorDid) identifiers.add(actorDid);

  const email = String(payload?.email || '').trim();
  if (email && payload?.email_verified === true) {
    identifiers.add(buildStableActorIdentifier({
      contactKind: StableActorContactKinds.Email,
      contact: email,
    }));
  }

  const phone = String(payload?.phone_number || '').trim();
  if (phone && payload?.phone_number_verified !== false) {
    identifiers.add(buildStableActorIdentifier({
      contactKind: StableActorContactKinds.Phone,
      contact: phone,
    }));
  }
  return Array.from(identifiers);
}
