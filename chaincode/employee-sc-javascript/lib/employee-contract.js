/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");

const ALLOWED_STATUS = new Set(["active", "suspended", "revoked"]);

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
    throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked`);
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

class EmployeeContract extends Contract {
  async CreateEmployee(ctx, employeeId, payloadJson) {
    const exists = await assetExists(ctx, employeeId);
    if (exists) {
      throw new Error(`Employee ${employeeId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.employeeId && payload.employeeId !== employeeId) {
      throw new Error(`Payload employeeId ${payload.employeeId} does not match ${employeeId}`);
    }
    if (!payload.orgId) {
      throw new Error("orgId is required");
    }
    if (!payload.email) {
      throw new Error("email is required");
    }
    if (!payload.role) {
      throw new Error("role is required");
    }

    const now = getTxTimestampSeconds(ctx.stub);
    const status = payload.status || "active";
    assertStatus(status);

    const asset = {
      employeeId,
      orgId: payload.orgId,
      did: payload.did || undefined,
      didDocHash: payload.didDocHash || undefined,
      didDocHashAlg: payload.didDocHashAlg || undefined,
      email: payload.email,
      role: payload.role,
      status,
      createdAt: now,
      updatedAt: now,
      revokedAt: status === "revoked" ? now : null,
    };

    await ctx.stub.putState(employeeId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async createEmployee(ctx, employeeId, payloadJson) {
    return this.CreateEmployee(ctx, employeeId, payloadJson);
  }

  async GetEmployee(ctx, employeeId) {
    return this.readEmployee(ctx, employeeId);
  }

  async readEmployee(ctx, employeeId) {
    return readAsset(ctx, employeeId, "Employee");
  }

  async UpdateEmployeeStatus(ctx, employeeId, status, ts) {
    assertStatus(status);
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const asset = await readAsset(ctx, employeeId, "Employee");
    asset.status = status;
    asset.updatedAt = timestamp;
    if (status === "active") {
      asset.revokedAt = null;
    }
    if (status === "revoked") {
      asset.revokedAt = timestamp;
    }

    await ctx.stub.putState(employeeId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async updateEmployeeStatus(ctx, employeeId, status, ts) {
    return this.UpdateEmployeeStatus(ctx, employeeId, status, ts);
  }

  async UpdateEmployeeDid(ctx, employeeId, did, didDocHash, didDocHashAlg, ts) {
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const asset = await readAsset(ctx, employeeId, "Employee");
    asset.did = did || asset.did;
    asset.didDocHash = didDocHash || asset.didDocHash;
    asset.didDocHashAlg = didDocHashAlg || asset.didDocHashAlg;
    asset.updatedAt = timestamp;

    await ctx.stub.putState(employeeId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async updateEmployeeDid(ctx, employeeId, did, didDocHash, didDocHashAlg, ts) {
    return this.UpdateEmployeeDid(ctx, employeeId, did, didDocHash, didDocHashAlg, ts);
  }

  async GetEmployeeHistory(ctx, employeeId) {
    return this.getEmployeeHistory(ctx, employeeId);
  }

  async getEmployeeHistory(ctx, employeeId) {
    return buildHistory(ctx, employeeId);
  }
}

module.exports = EmployeeContract;
