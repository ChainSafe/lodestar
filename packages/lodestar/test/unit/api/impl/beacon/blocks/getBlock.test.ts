import sinon from "sinon";
import * as blockUtils from "../../../../../../src/api/impl/beacon/blocks/utils";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import {generateEmptySignedBlock} from "../../../../../utils/block";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";
import {SinonStubFn} from "../../../../../utils/types";

use(chaiAsPromised);

describe("api - beacon - getBlock", function () {
  let resolveBlockIdStub: SinonStubFn<typeof blockUtils["resolveBlockId"]>;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
    resolveBlockIdStub = server.sandbox.stub(blockUtils, "resolveBlockId");
  });

  after(function () {
    server.sandbox.restore();
  });

  it("block not found", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "1").resolves(null);
    const result = await server.blockApi.getBlock("1");
    expect(result).to.be.null;
  });

  it("invalid block id", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "abc").throwsException();
    await expect(server.blockApi.getBlock("abc")).to.eventually.be.rejected;
  });

  it("success for non finalized block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "head").resolves(generateEmptySignedBlock());
    const result = await server.blockApi.getBlock("head");
    expect(result).to.not.be.null;
    expect(() => config.types.phase0.SignedBeaconBlock.assertValidValue(result)).to.not.throw();
  });

  it.skip("success for finalized block", async function () {
    resolveBlockIdStub.withArgs(config, sinon.match.any, sinon.match.any, "0").resolves(null);
    const result = await server.blockApi.getBlock("0");
    expect(result).to.not.be.null;
  });
});
