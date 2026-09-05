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

function parseFhirEvidenceBatch(payload) {
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("payload.data must be a non-empty array");
  }

  const parseOpaqueLinks = (value, path) => {
    if (value === undefined) return undefined;
    const items = Array.isArray(value) ? value : String(value).split(",");
    const normalized = Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
    if (normalized.some((item) => !/^(?:z[1-9A-HJ-NP-Za-km-z]+|b[a-z2-7]+)$/.test(item))) {
      throw new Error(`${path} must contain only opaque multibase or CID values`);
    }
    return normalized.length ? normalized : undefined;
  };

  return payload.data.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`data[${index}] must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(entry, "fullUrl")) {
      throw new Error(`data[${index}].fullUrl is not allowed`);
    }
    const resource = entry.resource;
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
      throw new Error(`data[${index}].resource must be an object`);
    }
    if (Object.prototype.hasOwnProperty.call(resource, "fullUrl")) {
      throw new Error(`data[${index}].resource.fullUrl is not allowed`);
    }
    const resourceType = String(resource.resourceType || "");
    if (!resourceType) throw new Error(`data[${index}].resource.resourceType is required`);
    if (String(entry.type || "") !== resourceType) {
      throw new Error(`data[${index}].type must equal resource.resourceType`);
    }
    const versionId = String(resource.meta?.versionId || "");
    if (!versionId) throw new Error(`data[${index}].resource.meta.versionId is required`);
    if (String(entry.id || "") !== versionId) {
      throw new Error(`data[${index}].id must equal resource.meta.versionId`);
    }
    const tags = Array.isArray(resource.meta?.tag)
      ? resource.meta.tag
        .filter((tag) => tag && typeof tag === "object" && !Array.isArray(tag) && typeof tag.id === "string" && tag.id)
        .map((tag) => ({
          id: tag.id,
          ...(typeof tag.system === "string" ? { system: tag.system } : {}),
          ...(typeof tag.code === "string" ? { code: tag.code } : {}),
          ...(typeof tag.version === "string" ? { version: tag.version } : {}),
          ...(typeof tag.userSelected === "boolean" ? { userSelected: tag.userSelected } : {}),
        }))
      : undefined;
    let relationships;
    if (entry.relationships !== undefined) {
      if (!entry.relationships || typeof entry.relationships !== "object" || Array.isArray(entry.relationships)) {
        throw new Error(`data[${index}].relationships must be an object`);
      }
      relationships = {};
      for (const [kind, value] of Object.entries(entry.relationships)) {
        const links = parseOpaqueLinks(value, `data[${index}].relationships.${kind}`);
        if (links) relationships[kind] = links;
      }
      if (!Object.keys(relationships).length) relationships = undefined;
    }
    const ownerships = parseOpaqueLinks(entry.ownerships, `data[${index}].ownerships`);

    return {
      id: versionId,
      resourceType,
      versionId,
      tags,
      relationships,
      ownerships,
    };
  });
}

class ArtifactContract extends Contract {
  /**
   * Processes a JSON:API-style data[] in one Fabric transaction. Each entry is
   * persisted as its own CID-keyed asset; the primary document itself is never
   * stored as an aggregate artifact.
   */
  async UpsertArtifacts(ctx, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    const evidence = parseFhirEvidenceBatch(payload);
    const data = [];

    for (const item of evidence) {
      const previous = (await existsAsset(ctx.stub, item.id))
        ? await readAsset(ctx.stub, item.id, ARTIFACT_ASSET_LABEL)
        : undefined;
      const asset = buildStoredArtifactAsset(ctx, item.id, {
        cid: item.id,
        hashAlg: "sha3-384",
        artifactType: "fhir-resource-version",
        declaredBy: payload.declaredBy,
        declaredByType: payload.declaredByType,
        relationships: item.relationships,
        ownerships: item.ownerships,
        meta: {
          attributes: {
            resourceType: item.resourceType,
            versionId: item.versionId,
            ...(item.tags?.length ? { tag: item.tags } : {}),
          },
        },
      }, previous);
      await writeJsonAsset(ctx.stub, item.id, asset);
      await writeCidIndex(ctx, item.id, item.id);
      data.push({ type: item.resourceType, id: item.id, resource: asset });
    }

    return { data };
  }

  async upsertArtifacts(ctx, payloadJson) {
    return this.UpsertArtifacts(ctx, payloadJson);
  }

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
