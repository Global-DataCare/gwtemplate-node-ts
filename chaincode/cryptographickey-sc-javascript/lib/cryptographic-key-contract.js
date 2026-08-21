/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");
const { isDeepStrictEqual } = require("node:util");
const { CRYPTOGRAPHIC_KEY_ASSET_LABEL, ORG_KEY_INDEX } = require("./constants");
const { buildStoredCryptographicKeyAsset } = require("./cryptographic-key-asset");
const existsAsset = require("./exists");
const { buildHistory } = require("./history");
const readAsset = require("./read");
const {
  assertStatus,
  parseJson,
  parseJsonArray,
  resolveKeyId,
} = require("./utils");
const writeJsonAsset = require("./write");

async function writeKeyIndex(ctx, orgId, keyId) {
  const indexKey = ctx.stub.createCompositeKey(ORG_KEY_INDEX, [orgId, keyId]);
  await ctx.stub.putState(indexKey, Buffer.from(""));
}

async function listKeysByOrg(ctx, orgId) {
  const iterator = await ctx.stub.getStateByPartialCompositeKey(ORG_KEY_INDEX, [orgId]);
  const keys = [];
  while (true) {
    const res = await iterator.next();
    if (res.value && res.value.key) {
      const composite = ctx.stub.splitCompositeKey(res.value.key);
      const keyId = composite.attributes[1];
      if (keyId) {
        const key = await readAsset(ctx.stub, keyId, CRYPTOGRAPHIC_KEY_ASSET_LABEL);
        keys.push(key);
      }
    }
    if (res.done) {
      await iterator.close();
      break;
    }
  }
  return keys;
}

function assertKeyPayload(keyId, payload) {
  const orgId = payload.orgId;
  if (!orgId) {
    throw new Error("orgId is required");
  }
  if (payload.keyId && payload.keyId !== keyId) {
    throw new Error(`Payload keyId ${payload.keyId} does not match ${keyId}`);
  }
  assertStatus(payload.status || "active");
}

function isCompatibleKey(existing, keyId, payload) {
  if (existing.keyId !== keyId || existing.orgId !== payload.orgId) return false;
  const requested = {
    kid: payload.kid,
    thumbprint: payload.thumbprint,
    kty: payload.kty,
    crv: payload.crv,
    alg: payload.alg,
    use: payload.use,
    purpose: payload.purpose,
    status: payload.status || "active",
    expiresAt: payload.expiresAt,
    origin: payload.origin,
  };
  return Object.entries(requested).every(([field, value]) => (
    value === undefined || isDeepStrictEqual(existing[field], value)
  ));
}

class CryptographicKeyContract extends Contract {
  async RegisterKey(ctx, keyId, payloadJson) {
    const exists = await existsAsset(ctx.stub, keyId);
    if (exists) {
      throw new Error(`${CRYPTOGRAPHIC_KEY_ASSET_LABEL} ${keyId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    assertKeyPayload(keyId, payload);
    const orgId = payload.orgId;

    const status = payload.status || "active";
    assertStatus(status);
    const asset = buildStoredCryptographicKeyAsset(ctx, keyId, orgId, payload);
    await writeJsonAsset(ctx.stub, keyId, asset);
    await writeKeyIndex(ctx, orgId, keyId);
    return asset;
  }

  async registerKey(ctx, keyId, payloadJson) {
    return this.RegisterKey(ctx, keyId, payloadJson);
  }

  async EnsureKey(ctx, keyId, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    assertKeyPayload(keyId, payload);
    const exists = await existsAsset(ctx.stub, keyId);
    if (!exists) {
      const asset = await this.RegisterKey(ctx, keyId, payloadJson);
      return { created: true, asset };
    }

    const existing = await readAsset(ctx.stub, keyId, CRYPTOGRAPHIC_KEY_ASSET_LABEL);
    if (!isCompatibleKey(existing, keyId, payload)) {
      throw new Error(`CRYPTOGRAPHIC_KEY_CONFLICT:${keyId}`);
    }
    return { created: false, asset: existing };
  }

  async ensureKey(ctx, keyId, payloadJson) {
    return this.EnsureKey(ctx, keyId, payloadJson);
  }

  async RegisterKeysBatch(ctx, orgId, keysJson) {
    const keys = Array.isArray(keysJson) ? keysJson : parseJsonArray(keysJson, "keys");
    const created = [];

    for (const key of keys) {
      if (!key || typeof key !== "object") {
        throw new Error("Invalid key payload");
      }
      if (key.orgId && key.orgId !== orgId) {
        throw new Error(`Key orgId ${key.orgId} does not match ${orgId}`);
      }
      const keyId = resolveKeyId(orgId, key);
      const exists = await existsAsset(ctx.stub, keyId);
      if (exists) {
        throw new Error(`CryptographicKey ${keyId} already exists`);
      }
      const status = key.status || "active";
      assertStatus(status);
      const asset = buildStoredCryptographicKeyAsset(ctx, keyId, orgId, key);
      await writeJsonAsset(ctx.stub, keyId, asset);
      await writeKeyIndex(ctx, orgId, keyId);
      created.push(asset);
    }

    return created;
  }

  async registerKeysBatch(ctx, orgId, keysJson) {
    return this.RegisterKeysBatch(ctx, orgId, keysJson);
  }

  async GetKey(ctx, keyId) {
    return this.readCryptographicKey(ctx, keyId);
  }

  async readCryptographicKey(ctx, keyId) {
    return readAsset(ctx.stub, keyId, CRYPTOGRAPHIC_KEY_ASSET_LABEL);
  }

  async ListKeysByOrg(ctx, orgId) {
    return listKeysByOrg(ctx, orgId);
  }

  async listKeysByOrg(ctx, orgId) {
    return this.ListKeysByOrg(ctx, orgId);
  }

  async ListActiveKeysByOrg(ctx, orgId, useFilter, purposeFilter) {
    const keys = await listKeysByOrg(ctx, orgId);
    return keys.filter((key) => {
      if (key.status !== "active") {
        return false;
      }
      if (useFilter && key.use !== useFilter) {
        return false;
      }
      if (purposeFilter && key.purpose !== purposeFilter) {
        return false;
      }
      return true;
    });
  }

  async listActiveKeysByOrg(ctx, orgId, useFilter, purposeFilter) {
    return this.ListActiveKeysByOrg(ctx, orgId, useFilter, purposeFilter);
  }

  async UpdateKeyStatus(ctx, keyId, status, ts) {
    assertStatus(status);
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const previousAsset = await readAsset(ctx.stub, keyId, CRYPTOGRAPHIC_KEY_ASSET_LABEL);
    const payload = {
      ...previousAsset,
      status,
      expiresAt: status === "expired" ? timestamp : previousAsset.expiresAt,
    };
    const asset = buildStoredCryptographicKeyAsset(ctx, keyId, previousAsset.orgId, payload, previousAsset);
    asset.updatedAt = timestamp;
    asset.meta.audit.updatedAt = timestamp;
    asset.meta.audit.txTime = timestamp;
    await writeJsonAsset(ctx.stub, keyId, asset);
    return asset;
  }

  async updateKeyStatus(ctx, keyId, status, ts) {
    return this.UpdateKeyStatus(ctx, keyId, status, ts);
  }

  async GetKeyHistory(ctx, keyId) {
    return this.getCryptographicKeyHistory(ctx, keyId);
  }

  async getCryptographicKeyHistory(ctx, keyId) {
    return buildHistory(ctx, keyId);
  }
}

module.exports = CryptographicKeyContract;
