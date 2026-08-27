/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

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

function readMetaAttributes(assetOrPayload) {
  const metaAttributes = assetOrPayload?.meta?.attributes;
  if (metaAttributes && typeof metaAttributes === "object" && !Array.isArray(metaAttributes)) {
    return metaAttributes;
  }
  const legacyMetadata = assetOrPayload?.metadata;
  if (legacyMetadata && typeof legacyMetadata === "object" && !Array.isArray(legacyMetadata)) {
    return legacyMetadata;
  }
  return {};
}

/**
 * Mirrors the common `meta.audit` shape without importing common-utils.
 *
 * @param {import("fabric-contract-api").Context} ctx
 * @param {Record<string, unknown>|undefined} previousAudit
 * @param {string} status
 * @param {boolean} isCreate
 * @returns {{createdAt:number,updatedAt:number,txId:string,txTime:number,status:string,version:number}}
 */
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
  buildAudit,
  parseJson,
  readMetaAttributes,
};
