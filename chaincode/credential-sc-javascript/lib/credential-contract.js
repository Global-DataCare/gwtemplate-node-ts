/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");

const ALLOWED_STATUS = new Set(["active", "suspended", "revoked", "expired"]);

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
    throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked, expired`);
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

async function buildCredentialHistory(ctx, assetId) {
  const iterator = await ctx.stub.getHistoryForKey(assetId);
  const history = [];
  while (true) {
    const res = await iterator.next();
    if (res.value && res.value.value && res.value.value.length) {
      const value = JSON.parse(res.value.value.toString("utf8"));
      history.push({
        id: value.id || assetId,
        status: value.status,
        timestamp: value.updatedAt || normalizeHistoryTimestamp(res.value.timestamp),
        txId: res.value.txId,
        actor: value.updatedBy || value.issuer,
        reason: value.reason,
        metadata: value.metadata,
      });
    }
    if (res.done) {
      await iterator.close();
      break;
    }
  }
  return history;
}

class CredentialContract extends Contract {
  async CreateCredential(ctx, credentialId, payloadJson) {
    const exists = await assetExists(ctx, credentialId);
    if (exists) {
      throw new Error(`Credential ${credentialId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.id && payload.id !== credentialId) {
      throw new Error(`Payload id ${payload.id} does not match ${credentialId}`);
    }

    const now = getTxTimestampSeconds(ctx.stub);
    const status = payload.status || "active";
    assertStatus(status);

    const asset = {
      id: credentialId,
      status,
      issuedAt: payload.issuedAt ?? now,
      updatedAt: payload.updatedAt ?? now,
      suspendedAt: status === "suspended" ? now : null,
      revokedAt: status === "revoked" ? now : null,
      expiresAt: payload.expiresAt ?? null,
      issuer: payload.issuer || undefined,
      subject: payload.subject || undefined,
      metadata: payload.metadata || undefined,
      updatedBy: payload.updatedBy || undefined,
      reason: payload.reason || undefined,
    };

    await ctx.stub.putState(credentialId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async createCredential(ctx, credentialId, payloadJson) {
    return this.CreateCredential(ctx, credentialId, payloadJson);
  }

  async GetCredential(ctx, credentialId) {
    return this.readCredential(ctx, credentialId);
  }

  async readCredential(ctx, credentialId) {
    return readAsset(ctx, credentialId, "Credential");
  }

  async UpdateCredentialStatus(ctx, credentialId, status, ts, actor, reason, metadataJson) {
    assertStatus(status);
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const asset = await readAsset(ctx, credentialId, "Credential");
    asset.status = status;
    asset.updatedAt = timestamp;
    if (actor) {
      asset.updatedBy = actor;
    }
    if (reason) {
      asset.reason = reason;
    }
    if (metadataJson) {
      asset.metadata = parseJson(metadataJson, "metadata");
    }
    if (status === "active") {
      asset.suspendedAt = null;
      asset.revokedAt = null;
    }
    if (status === "suspended") {
      asset.suspendedAt = timestamp;
    }
    if (status === "revoked") {
      asset.revokedAt = timestamp;
    }
    if (status === "expired") {
      asset.expiresAt = timestamp;
    }

    await ctx.stub.putState(credentialId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async updateCredentialStatus(ctx, credentialId, status, ts, actor, reason, metadataJson) {
    return this.UpdateCredentialStatus(ctx, credentialId, status, ts, actor, reason, metadataJson);
  }

  async GetCredentialHistory(ctx, credentialId) {
    return this.getCredentialHistory(ctx, credentialId);
  }

  async getCredentialHistory(ctx, credentialId) {
    return buildCredentialHistory(ctx, credentialId);
  }
}

module.exports = CredentialContract;
