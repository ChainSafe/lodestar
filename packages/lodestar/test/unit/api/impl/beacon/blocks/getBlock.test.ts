import sinon, {SinonStub} from "sinon";
import * as blockUtils from "../../../../../../src/api/impl/beacon/blocks/utils";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";

use(chaiAsPromised);

describe("api - beacon - getBlock", function () {
  let resolveBlockIdStub: SinonStub;
  let blockApi: BeaconBlockApi;

  beforeEach(() => {
    resolveBlockIdStub = this.ctx.sandbox.stub(blockUtils, "resolveBlockId");
    blockApi = this.ctx?.blockApi;
  });

  it("block not found", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "1").resolves(null);
    const result = await blockApi.getBlock("1");
    expect(result).to.be.null;
  });

  it("invalid block id", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "abc").throwsException();
    await expect(blockApi.getBlock("abc")).to.eventually.be.rejected;
  });

  it("success for non finalized block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "head").resolves(generateEmptySignedBlock());
    const result = await blockApi.getBlock("head");
    expect(result).to.not.be.null;
    expect(() => config.types.phase0.SignedBeaconBlock.assertValidValue(result)).to.not.throw();
  });

  it.skip("success for finalized block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "0").resolves(null);
    const result = await blockApi.getBlock("0");
    expect(result).to.not.be.null;
  });
});
