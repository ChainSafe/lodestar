import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {DebugBeaconApi} from "../../../../../../src/api/impl/debug/beacon";
import {IBeaconChain, LodestarForkChoice} from "../../../../../../src/chain";
import {generateBlockSummary} from "../../../../../utils/block";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {generateState} from "../../../../../utils/state";
import {setupApiImplTestServer} from "../../index.test";
import {testLogger} from "../../../../../utils/logger";
import {SinonStubFn} from "../../../../../utils/types";

describe("api - debug - beacon", function () {
  let debugApi: DebugBeaconApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkchoiceStub: SinonStubbedInstance<IForkChoice>;
  let dbStub: StubbedBeaconDb;
  let resolveStateIdStub: SinonStubFn<typeof stateApiUtils["resolveStateId"]>;
  const logger = testLogger();

  beforeEach(function () {
    const server = setupApiImplTestServer();
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    chainStub = server.chainStub;
    forkchoiceStub = sinon.createStubInstance(LodestarForkChoice);
    chainStub.forkChoice = forkchoiceStub;
    dbStub = new StubbedBeaconDb(sinon);
    debugApi = new DebugBeaconApi(
      {},
      {
        config,
        logger,
        chain: chainStub,
        db: dbStub,
      }
    );
  });

  afterEach(function () {
    resolveStateIdStub.restore();
  });

  it("getHeads - should return head", async function () {
    forkchoiceStub.getHeads.returns([generateBlockSummary({slot: 1000})]);
    const heads = await debugApi.getHeads();
    expect(heads).to.be.deep.equal([{slot: 1000, root: ZERO_HASH}]);
  });

  it("getHeads - should return null", async function () {
    forkchoiceStub.getHeads.throws("error from unit test");
    const heads = await debugApi.getHeads();
    expect(heads).to.be.null;
  });

  it("getState - should return state", async function () {
    resolveStateIdStub.resolves(generateState());
    const state = await debugApi.getState("something");
    expect(state).to.not.be.null;
  });

  it("getState - should return null", async function () {
    resolveStateIdStub.resolves(null);
    const state = await debugApi.getState("something");
    expect(state).to.be.null;
  });
});
