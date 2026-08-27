/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");
const { ARTIFACT_EVENT_ASSET_LABEL, ARTIFACT_EVENT_INDEX } = require("./constants");
const { buildStoredArtifactEventAsset } = require("./artifact-event-asset");
const existsAsset = require("./exists");
const { buildHistory } = require("./history");
const readAsset = require("./read");
const { parseJson } = require("./utils");
const writeJsonAsset = require("./write");

async function writeArtifactEventIndex(ctx, artifactId, eventId) {
  const indexKey = ctx.stub.createCompositeKey(ARTIFACT_EVENT_INDEX, [artifactId, eventId]);
  await ctx.stub.putState(indexKey, Buffer.from(""));
}

class ArtifactEventContract extends Contract {
  async CreateArtifactEvent(ctx, eventId, payloadJson) {
    if (await existsAsset(ctx.stub, eventId)) {
      throw new Error(`${ARTIFACT_EVENT_ASSET_LABEL} ${eventId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.eventId && payload.eventId !== eventId) {
      throw new Error(`Payload eventId ${payload.eventId} does not match ${eventId}`);
    }
    if (!payload.artifactId) {
      throw new Error("artifactId is required");
    }

    const asset = buildStoredArtifactEventAsset(ctx, eventId, payload);
    await writeJsonAsset(ctx.stub, eventId, asset);
    await writeArtifactEventIndex(ctx, asset.artifactId, eventId);
    return asset;
  }

  async createArtifactEvent(ctx, eventId, payloadJson) {
    return this.CreateArtifactEvent(ctx, eventId, payloadJson);
  }

  async ReadArtifactEvent(ctx, eventId) {
    return readAsset(ctx.stub, eventId, ARTIFACT_EVENT_ASSET_LABEL);
  }

  async readArtifactEvent(ctx, eventId) {
    return this.ReadArtifactEvent(ctx, eventId);
  }

  async ListEventsByArtifact(ctx, artifactId) {
    const iterator = await ctx.stub.getStateByPartialCompositeKey(ARTIFACT_EVENT_INDEX, [artifactId]);
    const events = [];
    while (true) {
      const res = await iterator.next();
      if (res.value && res.value.key) {
        const composite = ctx.stub.splitCompositeKey(res.value.key);
        const eventId = composite.attributes[1];
        if (eventId) {
          events.push(await readAsset(ctx.stub, eventId, ARTIFACT_EVENT_ASSET_LABEL));
        }
      }
      if (res.done) {
        await iterator.close();
        break;
      }
    }
    return events;
  }

  async listEventsByArtifact(ctx, artifactId) {
    return this.ListEventsByArtifact(ctx, artifactId);
  }

  async GetArtifactEventHistory(ctx, eventId) {
    return buildHistory(ctx, eventId);
  }

  async getArtifactEventHistory(ctx, eventId) {
    return this.GetArtifactEventHistory(ctx, eventId);
  }
}

module.exports = ArtifactEventContract;
