/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { getTxTimestampSeconds } = require("./history");
const { buildAudit } = require("./utils");

function buildStoredCryptographicKeyAsset(ctx, keyId, orgId, payload, previousAsset) {
  const now = getTxTimestampSeconds(ctx.stub);
  const status = String(payload.status || previousAsset?.meta?.audit?.status || previousAsset?.status || "active");
  return {
    keyId,
    orgId,
    kid: payload.kid || previousAsset?.kid || undefined,
    thumbprint: payload.thumbprint || previousAsset?.thumbprint || undefined,
    kty: payload.kty || previousAsset?.kty || undefined,
    crv: payload.crv || previousAsset?.crv || undefined,
    alg: payload.alg || previousAsset?.alg || undefined,
    use: payload.use || previousAsset?.use || undefined,
    purpose: payload.purpose || previousAsset?.purpose || undefined,
    status,
    createdAt: previousAsset?.createdAt || now,
    updatedAt: now,
    expiresAt: payload.expiresAt ?? previousAsset?.expiresAt ?? null,
    suspendedAt: status === "suspended" ? now : (status === "active" ? null : previousAsset?.suspendedAt || null),
    revokedAt: status === "revoked" ? now : (status === "active" ? null : previousAsset?.revokedAt || null),
    origin: payload.origin || previousAsset?.origin || undefined,
    meta: {
      audit: buildAudit(ctx, previousAsset?.meta?.audit, status, !previousAsset),
    },
  };
}

module.exports = {
  buildStoredCryptographicKeyAsset,
};
