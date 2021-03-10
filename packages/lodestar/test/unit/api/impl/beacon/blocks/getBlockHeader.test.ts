import sinon, {SinonStub} from "sinon";
import * as blockUtils from "../../../../../../src/api/impl/beacon/blocks/utils";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {BeaconBlockApi} from "../../../../../../src/api/impl/beacon/blocks";

use(chaiAsPromised);

describe("api - beacon - getBlockHeader", function () {
  let resolveBlockIdStub: SinonStub;
  let blockApi: BeaconBlockApi;

  beforeEach(() => {
    resolveBlockIdStub = this.ctx.sandbox.stub(blockUtils, "resolveBlockId");
    blockApi = this.ctx?.blockApi;
  });

  it("block not found", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "1").resolves(null);
    const result = await blockApi.getBlockHeader("1");
    expect(result).to.be.null;
  });

  it("invalid block id", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "abc").throwsException();
    await expect(blockApi.getBlockHeader("abc")).to.eventually.be.rejected;
  });

  it("success for block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "head").resolves(generateEmptySignedBlock());
    const result = await blockApi.getBlockHeader("head");
    expect(result).to.not.be.null;
    expect(() => config.types.phase0.SignedBeaconHeaderResponse.assertValidValue(result)).to.not.throw();
  });
});
