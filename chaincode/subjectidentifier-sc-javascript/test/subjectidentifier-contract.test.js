// Flow contract: derive the opaque id before Fabric; store and resolve only indexProviderDid; reject private identity/card fields and provider takeover.
"use strict";

const chai = require("chai");
chai.use(require("chai-as-promised"));
const { expect } = chai;
const { SubjectIdentifierContract } = require("../index");
const { createContractContext } = require("../../test-support/contract-test-context");

const ASSET_ID = "urn:multibase:zQmWATW6YwRbc2Qfq5Qv7FpC18JNpDutLCRa14Q6gttxyP";
const INDEX_PROVIDER_DID = "did:web:index.example.org";

describe("SubjectIdentifierContract", () => {
  it("creates and reads an opaque pointer whose only business field is indexProviderDid", async () => {
    const ctx = createContractContext({ txSeconds: 100 });
    const contract = new SubjectIdentifierContract();

    const asset = await contract.UpsertSubjectIdentifier(
      ctx,
      ASSET_ID,
      JSON.stringify({ indexProviderDid: INDEX_PROVIDER_DID }),
    );

    expect(asset).to.deep.equal({ assetId: ASSET_ID, indexProviderDid: INDEX_PROVIDER_DID, createdAt: 100, updatedAt: 100 });
    expect(await contract.ReadSubjectIdentifier(ctx, ASSET_ID)).to.deep.equal(asset);
    expect(JSON.stringify(asset)).not.to.include("card");
  });

  it("rejects extra identity fields and a conflicting provider", async () => {
    const contract = new SubjectIdentifierContract();
    await expect(contract.UpsertSubjectIdentifier(
      createContractContext(),
      ASSET_ID,
      JSON.stringify({ indexProviderDid: INDEX_PROVIDER_DID, card: "private" }),
    )).to.be.rejectedWith("must contain only indexProviderDid");

    const existing = { assetId: ASSET_ID, indexProviderDid: INDEX_PROVIDER_DID, createdAt: 10, updatedAt: 10 };
    await expect(contract.UpsertSubjectIdentifier(
      createContractContext({ existingState: { [ASSET_ID]: existing } }),
      ASSET_ID,
      JSON.stringify({ indexProviderDid: "did:web:other.example" }),
    )).to.be.rejectedWith("SubjectIdentifierProviderConflict");
  });

  it("deletes by opaque asset and current provider only", async () => {
    const existing = { assetId: ASSET_ID, indexProviderDid: INDEX_PROVIDER_DID, createdAt: 10, updatedAt: 10 };
    const ctx = createContractContext({ existingState: { [ASSET_ID]: existing } });
    const contract = new SubjectIdentifierContract();

    expect(await contract.DeleteSubjectIdentifier(ctx, ASSET_ID, INDEX_PROVIDER_DID)).to.deep.equal({ assetId: ASSET_ID, deleted: true });
    await expect(contract.ReadSubjectIdentifier(ctx, ASSET_ID)).to.be.rejectedWith("does not exist");
  });
});
