// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';

/**
 * Returns the operational employee DID authenticated for one queued request.
 * Verified SMART `sub` is authoritative; signed DIDComm `iss` is the fallback.
 * Plain request claims are never read as authentication evidence here.
 */
export function getAuthenticatedJobActorDid(job: JobRequest): string | undefined {
  const bearerSubject = String((job.content as any)?.meta?.bearer?.jwt?.payload?.sub || '').trim();
  if (bearerSubject.startsWith('did:web:')) return bearerSubject;
  const signedIssuer = String(job.content?.iss || '').trim();
  return signedIssuer.startsWith('did:web:') ? signedIssuer : undefined;
}
