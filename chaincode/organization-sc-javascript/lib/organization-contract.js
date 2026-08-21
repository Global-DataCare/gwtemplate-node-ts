/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");
const { isDeepStrictEqual } = require("node:util");
const { EVIDENCE_PREFIX, ORGANIZATION_ASSET_LABEL } = require("./constants");
const existsAsset = require("./exists");
const { buildHistory, getTxTimestampSeconds } = require("./history");
const {
  assertStatus,
  buildStoredOrganizationAsset,
  getEvidenceHashes,
} = require("./organization-asset");
const { parseJson } = require("./utils");
const readAsset = require("./read");
const writeJsonAsset = require("./write");

class OrganizationContract extends Contract {
  async CreateOrganization(ctx, orgId, payloadJson) {
    const exists = await existsAsset(ctx.stub, orgId);
    if (exists) {
      throw new Error(`${ORGANIZATION_ASSET_LABEL} ${orgId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.orgId && payload.orgId !== orgId) {
      throw new Error(`Payload orgId ${payload.orgId} does not match ${orgId}`);
    }
    if (!payload.vc || typeof payload.vc !== "object" || Array.isArray(payload.vc)) {
      throw new Error("vc is required");
    }

    const { docHash, signedHash } = getEvidenceHashes(payload.vc?.credentialSubject?.evidence || payload.vc?.evidence);
    if (docHash && signedHash) {
      const evidenceKey = ctx.stub.createCompositeKey(EVIDENCE_PREFIX, [docHash, signedHash]);
      const existing = await ctx.stub.getState(evidenceKey);
      if (existing && existing.length) {
        throw new Error("EvidenceAlreadyRegistered");
      }
      await ctx.stub.putState(evidenceKey, Buffer.from(orgId));
    }

    const asset = buildStoredOrganizationAsset(ctx, orgId, payload);
    await writeJsonAsset(ctx.stub, orgId, asset);
    return asset;
  }

  async createOrganization(ctx, orgId, payloadJson) {
    return this.CreateOrganization(ctx, orgId, payloadJson);
  }

  async EnsureOrganization(ctx, orgId, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    if (payload.orgId && payload.orgId !== orgId) {
      throw new Error(`Payload orgId ${payload.orgId} does not match ${orgId}`);
    }
    if (!payload.vc || typeof payload.vc !== "object" || Array.isArray(payload.vc)) {
      throw new Error("vc is required");
    }
    const exists = await existsAsset(ctx.stub, orgId);
    if (!exists) {
      const asset = await this.CreateOrganization(ctx, orgId, payloadJson);
      return { created: true, asset };
    }

    const existing = await readAsset(ctx.stub, orgId, ORGANIZATION_ASSET_LABEL);
    if (existing.orgId !== orgId || !isDeepStrictEqual(existing.vc, payload.vc)) {
      throw new Error(`ORGANIZATION_CONFLICT:${orgId}`);
    }
    return { created: false, asset: existing };
  }

  async ensureOrganization(ctx, orgId, payloadJson) {
    return this.EnsureOrganization(ctx, orgId, payloadJson);
  }

  async GetOrganization(ctx, orgId) {
    return this.readOrganization(ctx, orgId);
  }

  async readOrganization(ctx, orgId) {
    return readAsset(ctx.stub, orgId, ORGANIZATION_ASSET_LABEL);
  }

  async UpdateOrganizationStatus(ctx, orgId, status, ts) {
    assertStatus(status);
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const previousAsset = await readAsset(ctx.stub, orgId, ORGANIZATION_ASSET_LABEL);
    const asset = buildStoredOrganizationAsset(ctx, orgId, { ...previousAsset, status }, previousAsset);
    asset.meta.audit.updatedAt = timestamp;
    asset.meta.audit.txTime = timestamp;
    await writeJsonAsset(ctx.stub, orgId, asset);
    return asset;
  }

  async updateOrganizationStatus(ctx, orgId, status, ts) {
    return this.UpdateOrganizationStatus(ctx, orgId, status, ts);
  }

  async UpsertDidBySector(ctx, orgId, sector, did, didDocHash, didDocHashAlg, ts) {
    void ctx;
    void orgId;
    void sector;
    void did;
    void didDocHash;
    void didDocHashAlg;
    void ts;
    throw new Error("UpsertDidBySector is deprecated. Hosted DID routing does not belong in organization-sc");
  }

  async upsertDidBySector(ctx, orgId, sector, did, didDocHash, didDocHashAlg, ts) {
    return this.UpsertDidBySector(ctx, orgId, sector, did, didDocHash, didDocHashAlg, ts);
  }

  async GetOrganizationHistory(ctx, orgId) {
    return this.getOrganizationHistory(ctx, orgId);
  }

  async getOrganizationHistory(ctx, orgId) {
    return buildHistory(ctx, orgId);
  }
}

module.exports = OrganizationContract;
