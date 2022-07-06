import sinon from "sinon";
import {expect, use} from "chai";
import chaiAsPromised from "chai-as-promised";
import * as blockUtils from "../../../../../../src/api/impl/beacon/blocks/utils.js";
import {generateEmptySignedBlock} from "../../../../../utils/block.js";
import {ApiImplTestModules, setupApiImplTestServer} from "../../index.test.js";
import {SinonStubFn} from "../../../../../utils/types.js";

use(chaiAsPromised);

// TODO remove stub
describe.skip("api - beacon - getBlockHeader", function () {
  let resolveBlockIdStub: SinonStubFn<typeof blockUtils["resolveBlockId"]>;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
    resolveBlockIdStub = server.sandbox.stub(blockUtils, "resolveBlockId");
  });

  after(function () {
    server.sandbox.restore();
  });

  it("invalid block id", async function () {
    resolveBlockIdStub.withArgs(sinon.match.any, sinon.match.any, "abc").throwsException();
    await expect(server.blockApi.getBlockHeader("abc")).to.eventually.be.rejected;
  });

  it("success for block", async function () {
    resolveBlockIdStub.withArgs(sinon.match.any, sinon.match.any, "head").resolves(generateEmptySignedBlock());
    const result = await server.blockApi.getBlockHeader("head");
    expect(result).to.not.be.null;
  });
});
