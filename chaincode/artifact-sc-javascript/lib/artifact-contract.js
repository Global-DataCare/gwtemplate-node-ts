/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");
const { ARTIFACT_ASSET_LABEL, CID_INDEX } = require("./constants");
const existsAsset = require("./exists");
const { buildHistory } = require("./history");
const { buildStoredArtifactAsset } = require("./artifact-asset");
const readAsset = require("./read");
const { parseJson } = require("./utils");
const writeJsonAsset = require("./write");

async function writeCidIndex(ctx, cid, artifactId) {
  if (!cid) return;
  const indexKey = ctx.stub.createCompositeKey(CID_INDEX, [cid, artifactId]);
  await ctx.stub.putState(indexKey, Buffer.from(""));
}

class ArtifactContract extends Contract {
  async CreateArtifact(ctx, artifactId, payloadJson) {
    const exists = await existsAsset(ctx.stub, artifactId);
    if (exists) {
      throw new Error(`${ARTIFACT_ASSET_LABEL} ${artifactId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.artifactId && payload.artifactId !== artifactId) {
      throw new Error(`Payload artifactId ${payload.artifactId} does not match ${artifactId}`);
    }
    if (!payload.hash && !payload.cid) {
      throw new Error("hash or cid is required");
    }

    const asset = buildStoredArtifactAsset(ctx, artifactId, payload);
    await writeJsonAsset(ctx.stub, artifactId, asset);
    await writeCidIndex(ctx, asset.cid, artifactId);
    return asset;
  }

  async createArtifact(ctx, artifactId, payloadJson) {
    return this.CreateArtifact(ctx, artifactId, payloadJson);
  }

  async UpsertArtifact(ctx, artifactId, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    if (!(await existsAsset(ctx.stub, artifactId))) {
      return this.CreateArtifact(ctx, artifactId, payloadJson);
    }

    const previous = await readAsset(ctx.stub, artifactId, ARTIFACT_ASSET_LABEL);
    const next = buildStoredArtifactAsset(ctx, artifactId, payload, previous);
    await writeJsonAsset(ctx.stub, artifactId, next);
    await writeCidIndex(ctx, next.cid, artifactId);
    return next;
  }

  async upsertArtifact(ctx, artifactId, payloadJson) {
    return this.UpsertArtifact(ctx, artifactId, payloadJson);
  }

  async ReadArtifact(ctx, artifactId) {
    return readAsset(ctx.stub, artifactId, ARTIFACT_ASSET_LABEL);
  }

  async readArtifact(ctx, artifactId) {
    return this.ReadArtifact(ctx, artifactId);
  }

  async GetArtifactHistory(ctx, artifactId) {
    return buildHistory(ctx, artifactId);
  }

  async getArtifactHistory(ctx, artifactId) {
    return this.GetArtifactHistory(ctx, artifactId);
  }
}

module.exports = ArtifactContract;
