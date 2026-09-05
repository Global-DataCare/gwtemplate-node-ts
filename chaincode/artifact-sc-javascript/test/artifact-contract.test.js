// Flow contract: one primary-document data[] is processed atomically into one
// CID-keyed asset per entry; the chaincode strips claims and display text and
// never stores fullUrl or a clinical FHIR resource.
// TDD contract: write this test red first; make it green only with the complete real behavior.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const ArtifactContract = contractModule.ArtifactContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const ARTIFACT_ID = "artifact_sha256_abc";

function createContract() {
  return new ArtifactContract();
}

function buildPayload(overrides = {}) {
  return {
    artifactId: ARTIFACT_ID,
    hash: "abc",
    hashAlg: "sha256",
    artifactType: "pdf",
    declaredBy: "acme-id",
    declaredByType: "tenant",
    meta: { attributes: { source: "pdf" } },
    ...overrides,
  };
}

describe("ArtifactContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(ArtifactContract);
  });

  it("creates, upserts, reads and returns history for artifact assets", async () => {
    const createCtx = createContractContext({ txSeconds: 11, txId: "TX-A-1" });
    const created = await contract.CreateArtifact(createCtx, ARTIFACT_ID, JSON.stringify(buildPayload({ cid: "bafy123" })));
    expect(created.meta.audit.version).to.equal(1);
    expect(createCtx.readText("cid~artifact\u0000bafy123\u0000artifact_sha256_abc")).to.equal("");

    const upsertCtx = createContractContext({
      txSeconds: 22,
      txId: "TX-A-2",
      existingState: { [ARTIFACT_ID]: created, "cid~artifact\u0000bafy123\u0000artifact_sha256_abc": "" },
      historyByKey: {
        [ARTIFACT_ID]: [{
          txId: "TX-H-1",
          timestamp: { seconds: { low: 99 } },
          isDelete: false,
          value: Buffer.from(JSON.stringify(created)),
        }],
      },
    });
    const upserted = await contract.upsertArtifact(upsertCtx, ARTIFACT_ID, JSON.stringify(buildPayload({
      status: "validated",
      validationCount: 2,
      meta: { attributes: { verifiedBy: "ica" } },
    })));
    expect(upserted.status).to.equal("validated");
    expect(upserted.validationCount).to.equal(2);
    expect(upserted.meta.audit.version).to.equal(2);
    expect(upserted.meta.attributes).to.deep.equal({ source: "pdf", verifiedBy: "ica" });

    const read = await contract.readArtifact(upsertCtx, ARTIFACT_ID);
    expect(read.artifactId).to.equal(ARTIFACT_ID);
    const readAlias = await contract.ReadArtifact(upsertCtx, ARTIFACT_ID);
    expect(readAlias.artifactId).to.equal(ARTIFACT_ID);
    const history = await contract.getArtifactHistory(upsertCtx, ARTIFACT_ID);
    expect(history[0].timestamp).to.equal(99);
    const historyAlias = await contract.GetArtifactHistory(upsertCtx, ARTIFACT_ID);
    expect(historyAlias).to.have.length(1);
  });

  it("processes every data entry as an individual CID-keyed asset in one batch", async () => {
    const ctx = createContractContext({ txSeconds: 12, txId: "TX-A-BATCH" });
    const data = [
      { type: "Observation", id: "bafy-observation-1", resource: { resourceType: "Observation", meta: { versionId: "bafy-observation-1", claims: { "Observation.code": "85354-9", "Observation.code-display": "must stay private" }, tag: [
        { id: "Observation[0].code", system: "http://loinc.org", code: "85354-9", version: "2.78", userSelected: true, display: "must stay private" },
        { id: "Observation[0].category" },
      ] } } },
      { type: "Condition", id: "bafy-condition-1", resource: { resourceType: "Condition", meta: { versionId: "bafy-condition-1" } } },
    ];

    const result = await contract.UpsertArtifacts(ctx, JSON.stringify({ data }));

    expect(result.data).to.have.length(2);
    expect(ctx.readJson("bafy-observation-1").artifactId).to.equal("bafy-observation-1");
    expect(ctx.readJson("bafy-condition-1").artifactId).to.equal("bafy-condition-1");
    expect(ctx.readJson("bafy-observation-1")).not.to.have.any.keys("fullUrl", "resource");
    expect(ctx.readJson("bafy-observation-1").meta.attributes.tag).to.deep.equal([
      { id: "Observation[0].code", system: "http://loinc.org", code: "85354-9", version: "2.78", userSelected: true },
      { id: "Observation[0].category" },
    ]);
    expect(ctx.readJson("bafy-observation-1").meta.attributes).not.to.have.property("claims");
    expect(ctx.writes.filter(({ key }) => !key.startsWith("cid~artifact"))).to.have.length(2);

    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], fullUrl: "urn:uuid:not-ledger-safe" }],
    }))).to.be.rejectedWith("data[0].fullUrl is not allowed");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], id: "different-cid" }],
    }))).to.be.rejectedWith("data[0].id must equal resource.meta.versionId");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ type: data[0].type, resource: data[0].resource }],
    }))).to.be.rejectedWith("data[0].id must equal resource.meta.versionId");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [] })))
      .to.be.rejectedWith("payload.data must be a non-empty array");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [null] })))
      .to.be.rejectedWith("data[0] must be an object");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [{ ...data[0], type: "Condition" }] })))
      .to.be.rejectedWith("data[0].type must equal resource.resourceType");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ id: data[0].id, resource: data[0].resource }],
    }))).to.be.rejectedWith("data[0].type must equal resource.resourceType");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [{ ...data[0], resource: null }] })))
      .to.be.rejectedWith("data[0].resource must be an object");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], resource: { ...data[0].resource, fullUrl: "urn:uuid:not-ledger-safe" } }],
    }))).to.be.rejectedWith("data[0].resource.fullUrl is not allowed");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], resource: { meta: data[0].resource.meta } }],
    }))).to.be.rejectedWith("data[0].resource.resourceType is required");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], resource: { resourceType: data[0].resource.resourceType } }],
    }))).to.be.rejectedWith("data[0].resource.meta.versionId is required");

    const minimalCid = "bafy-minimal";
    const minimal = {
      data: [{
        type: "Observation",
        id: minimalCid,
        resource: { resourceType: "Observation", meta: { versionId: minimalCid } },
      }],
    };
    const first = await contract.upsertArtifacts(ctx, JSON.stringify(minimal));
    const second = await contract.UpsertArtifacts(ctx, JSON.stringify(minimal));
    expect(first.data[0].resource.meta.audit.version).to.equal(1);
    expect(second.data[0].resource.meta.audit.version).to.equal(2);
  });

  it("creates through upsert when missing and rejects duplicates or invalid payloads", async () => {
    const missingCtx = createContractContext({ txSeconds: 33, txId: "TX-A-3" });
    const created = await contract.UpsertArtifact(missingCtx, ARTIFACT_ID, JSON.stringify(buildPayload()));
    expect(created.meta.audit.version).to.equal(1);
    const createdAlias = await contract.createArtifact(createContractContext({ txSeconds: 34, txId: "TX-A-4" }), "artifact_alias", JSON.stringify(buildPayload({ artifactId: "artifact_alias", cid: "cid-alias" })));
    expect(createdAlias.artifactId).to.equal("artifact_alias");

    await expect(contract.CreateArtifact(
      createContractContext({ existingState: { [ARTIFACT_ID]: buildPayload() } }),
      ARTIFACT_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith(`Artifact ${ARTIFACT_ID} already exists`);

    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, JSON.stringify("bad")))
      .to.be.rejectedWith("payload must be an object");
    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, JSON.stringify(buildPayload({ artifactId: "other" }))))
      .to.be.rejectedWith("Payload artifactId other does not match artifact_sha256_abc");
    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, JSON.stringify({ artifactId: ARTIFACT_ID })))
      .to.be.rejectedWith("hash or cid is required");
    await expect(contract.readArtifact(createContractContext(), ARTIFACT_ID))
      .to.be.rejectedWith(`Artifact ${ARTIFACT_ID} does not exist`);
  });
});
