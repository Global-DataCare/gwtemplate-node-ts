/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { ALLOWED_STATUS } = require("./constants");
const { getTxTimestampSeconds } = require("./history");

function parseJson(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed;
}

function parseJsonArray(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  const parsed = JSON.parse(input);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be an array`);
  }
  return parsed;
}

function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked, expired`);
  }
}

function resolveKeyId(orgId, key) {
  if (key.keyId) {
    return key.keyId;
  }
  if (key.kid) {
    return `${orgId}_${key.kid}`;
  }
  if (key.thumbprint) {
    return `${orgId}_${key.thumbprint}`;
  }
  throw new Error("keyId, kid, or thumbprint is required");
}

function buildAudit(ctx, previousAudit, status, isCreate) {
  const txTime = getTxTimestampSeconds(ctx.stub);
  const txId = ctx.stub.getTxID();
  return {
    createdAt: isCreate ? txTime : Number(previousAudit?.createdAt || txTime),
    updatedAt: txTime,
    txId,
    txTime,
    status,
    version: isCreate ? 1 : (Number(previousAudit?.version) || 1) + 1,
  };
}

module.exports = {
  assertStatus,
  buildAudit,
  parseJson,
  parseJsonArray,
  resolveKeyId,
};
