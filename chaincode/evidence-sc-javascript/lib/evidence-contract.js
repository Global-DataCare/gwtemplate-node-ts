/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");

const ALLOWED_STATUS = new Set(["active", "revoked", "expired"]);

function getTxTimestampSeconds(stub) {
  const ts = stub.getTxTimestamp();
  const seconds = typeof ts.seconds === "object" && typeof ts.seconds.toNumber === "function"
    ? ts.seconds.toNumber()
    : Number(ts.seconds);
  return seconds;
}

function parseJson(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  return JSON.parse(input);
}

function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid status ${status}. Allowed: active, revoked, expired`);
  }
}

async function assetExists(ctx, assetId) {
  const buffer = await ctx.stub.getState(assetId);
  return !!buffer && buffer.length > 0;
}

async function readAsset(ctx, assetId, label) {
  const buffer = await ctx.stub.getState(assetId);
  if (!buffer || buffer.length === 0) {
    throw new Error(`${label} ${assetId} does not exist`);
  }
  return JSON.parse(buffer.toString("utf8"));
}

function normalizeHistoryTimestamp(timestamp) {
  if (!timestamp || !timestamp.seconds) {
    return 0;
  }
  if (typeof timestamp.seconds === "object" && typeof timestamp.seconds.toNumber === "function") {
    return timestamp.seconds.toNumber();
  }
  if (typeof timestamp.seconds === "object" && typeof timestamp.seconds.low === "number") {
    return timestamp.seconds.low;
  }
  return Number(timestamp.seconds);
}

async function buildHistory(ctx, assetId) {
  const iterator = await ctx.stub.getHistoryForKey(assetId);
  const history = [];
  while (true) {
    const res = await iterator.next();
    if (res.value) {
      const value = res.value.value && res.value.value.length
        ? JSON.parse(res.value.value.toString("utf8"))
        : null;
      history.push({
        txId: res.value.txId,
        timestamp: normalizeHistoryTimestamp(res.value.timestamp),
        isDelete: res.value.isDelete,
        value,
      });
    }
    if (res.done) {
      await iterator.close();
      break;
    }
  }
  return history;
}

class EvidenceContract extends Contract {
  async CreateEvidence(ctx, assetId, payloadJson) {
    const exists = await assetExists(ctx, assetId);
    if (exists) {
      throw new Error(`Evidence ${assetId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.evidenceId && payload.subjectId) {
      const expectedId = `${payload.subjectId}_${payload.evidenceId}`;
      if (expectedId !== assetId) {
        throw new Error(`Payload evidenceId/subjectId does not match ${assetId}`);
      }
    }
    if (!payload.subjectType) {
      throw new Error("subjectType is required");
    }
    if (!payload.subjectId) {
      throw new Error("subjectId is required");
    }
    if (!payload.evidenceType) {
      throw new Error("evidenceType is required");
    }
    if (!payload.hash) {
      throw new Error("hash is required");
    }
    if (!payload.hashAlg) {
      throw new Error("hashAlg is required");
    }
    if (!payload.issuer) {
      throw new Error("issuer is required");
    }

    const now = getTxTimestampSeconds(ctx.stub);
    const status = payload.status || "active";
    assertStatus(status);

    const asset = {
      evidenceId: payload.evidenceId || assetId,
      subjectType: payload.subjectType,
      subjectId: payload.subjectId,
      evidenceType: payload.evidenceType,
      hash: payload.hash,
      hashAlg: payload.hashAlg,
      issuer: payload.issuer,
      status,
      issuedAt: payload.issuedAt ?? now,
      expiresAt: payload.expiresAt ?? null,
      revokedAt: status === "revoked" ? now : null,
    };

    await ctx.stub.putState(assetId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async createEvidence(ctx, assetId, payloadJson) {
    return this.CreateEvidence(ctx, assetId, payloadJson);
  }

  async GetEvidence(ctx, assetId) {
    return this.readEvidence(ctx, assetId);
  }

  async readEvidence(ctx, assetId) {
    return readAsset(ctx, assetId, "Evidence");
  }

  async UpdateEvidenceStatus(ctx, assetId, status, ts) {
    assertStatus(status);
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const asset = await readAsset(ctx, assetId, "Evidence");
    asset.status = status;
    if (status === "revoked") {
      asset.revokedAt = timestamp;
    }
    if (status === "expired") {
      asset.expiresAt = timestamp;
    }

    await ctx.stub.putState(assetId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async updateEvidenceStatus(ctx, assetId, status, ts) {
    return this.UpdateEvidenceStatus(ctx, assetId, status, ts);
  }

  async GetEvidenceHistory(ctx, assetId) {
    return this.getEvidenceHistory(ctx, assetId);
  }

  async getEvidenceHistory(ctx, assetId) {
    return buildHistory(ctx, assetId);
  }
}

module.exports = EvidenceContract;
