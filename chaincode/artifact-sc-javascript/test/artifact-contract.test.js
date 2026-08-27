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
