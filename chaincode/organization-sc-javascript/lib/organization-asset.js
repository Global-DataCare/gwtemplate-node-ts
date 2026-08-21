/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { ALLOWED_STATUS } = require("./constants");
const { getTxTimestampSeconds } = require("./history");
const { buildAudit } = require("./utils");

function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked`);
  }
}

function normalizeEvidenceHash(input) {
  if (!input) return undefined;
  if (typeof input === "string") return input.trim();
  if (typeof input === "object") {
    return (input.hashValue || input.value || input.digest || "").toString().trim();
  }
  return undefined;
}

function getEvidenceHashes(evidence) {
  if (!evidence) return {};
  const entries = Array.isArray(evidence) ? evidence : [evidence];
  let docHash;
  let signedHash;
  for (const entry of entries) {
    const digests = entry?.digest || entry?.digests;
    const digestEntries = Array.isArray(digests) ? digests : (digests ? [digests] : []);
    for (const digest of digestEntries) {
      const type = (digest?.type || "").toString().toLowerCase();
      const hash = normalizeEvidenceHash(digest);
      if (!hash) continue;
      if (type.includes("signeddocumenthash")) {
        signedHash = hash;
      } else if (type.includes("documenthash")) {
        docHash = hash;
      }
    }
  }
  return { docHash, signedHash };
}

function buildStoredOrganizationAsset(ctx, orgId, payload, previousAsset) {
  const status = String(payload.status || previousAsset?.meta?.audit?.status || "active");
  assertStatus(status);

  return {
    orgId,
    vc: payload.vc || previousAsset?.vc,
    meta: {
      audit: buildAudit(ctx, previousAsset?.meta?.audit, status, !previousAsset),
    },
  };
}

module.exports = {
  assertStatus,
  buildStoredOrganizationAsset,
  getEvidenceHashes,
};
