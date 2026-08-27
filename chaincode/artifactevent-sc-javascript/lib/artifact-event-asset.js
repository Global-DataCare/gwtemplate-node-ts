/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { getTxTimestampSeconds } = require("./history");
const { buildAudit, readMetaAttributes } = require("./utils");

function buildStoredArtifactEventAsset(ctx, eventId, payload, previousAsset) {
  const now = getTxTimestampSeconds(ctx.stub);
  const status = String(payload.status || previousAsset?.meta?.audit?.status || previousAsset?.status || "active");

  return {
    eventId,
    artifactId: payload.artifactId || previousAsset?.artifactId,
    eventType: payload.eventType || previousAsset?.eventType || "declaration",
    eventSubType: payload.eventSubType || previousAsset?.eventSubType || undefined,
    actor: payload.actor || previousAsset?.actor || undefined,
    actorType: payload.actorType || previousAsset?.actorType || undefined,
    status,
    issuedAt: payload.issuedAt ?? previousAsset?.issuedAt ?? now,
    expiresAt: payload.expiresAt ?? previousAsset?.expiresAt ?? null,
    revokedAt: payload.revokedAt ?? previousAsset?.revokedAt ?? null,
    artifactHash: payload.artifactHash || previousAsset?.artifactHash || undefined,
    artifactHashAlg: payload.artifactHashAlg || previousAsset?.artifactHashAlg || undefined,
    evidenceHash: payload.evidenceHash || previousAsset?.evidenceHash || undefined,
    evidenceHashAlg: payload.evidenceHashAlg || previousAsset?.evidenceHashAlg || undefined,
    evidenceRef: payload.evidenceRef || previousAsset?.evidenceRef || undefined,
    meta: {
      attributes: {
        ...readMetaAttributes(previousAsset),
        ...readMetaAttributes(payload),
      },
      audit: buildAudit(ctx, previousAsset?.meta?.audit, status, !previousAsset),
    },
  };
}

module.exports = {
  buildStoredArtifactEventAsset,
};
