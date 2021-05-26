import {config} from "@chainsafe/lodestar-config/mainnet";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {expect} from "chai";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import * as stateApiUtils from "../../../../../src/api/impl/beacon/state/utils";
import {getDebugApi} from "../../../../../src/api/impl/debug";
import {INetwork, Network} from "../../../../../src/network";
import {IBeaconChain, LodestarForkChoice} from "../../../../../src/chain";
import {generateBlockSummary} from "../../../../utils/block";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {generateState} from "../../../../utils/state";
import {setupApiImplTestServer} from "../index.test";
import {SinonStubFn} from "../../../../utils/types";

describe("api - debug - beacon", function () {
  let debugApi: ReturnType<typeof getDebugApi>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let forkchoiceStub: SinonStubbedInstance<IForkChoice>;
  let dbStub: StubbedBeaconDb;
  let networkStub: SinonStubbedInstance<INetwork>;
  let resolveStateIdStub: SinonStubFn<typeof stateApiUtils["resolveStateId"]>;

  beforeEach(function () {
    const server = setupApiImplTestServer();
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    chainStub = server.chainStub;
    forkchoiceStub = sinon.createStubInstance(LodestarForkChoice);
    chainStub.forkChoice = forkchoiceStub;
    dbStub = new StubbedBeaconDb(sinon);
    networkStub = sinon.createStubInstance(Network);
    debugApi = getDebugApi({chain: chainStub, db: dbStub, config, network: networkStub});
  });

  afterEach(function () {
    resolveStateIdStub.restore();
  });

  it("getHeads - should return head", async function () {
    forkchoiceStub.getHeads.returns([generateBlockSummary({slot: 1000})]);
    const heads = await debugApi.getHeads();
    expect(heads).to.be.deep.equal([{slot: 1000, root: ZERO_HASH}]);
  });

  it("getState - should return state", async function () {
    resolveStateIdStub.resolves(generateState());
    const state = await debugApi.getState("something");
    expect(state).to.not.be.null;
  });
});
