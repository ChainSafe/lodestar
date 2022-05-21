import {config} from "@chainsafe/lodestar-config/default";
import {config as minimalConfig} from "@chainsafe/lodestar-config/default";
import {altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {toHexString} from "@chainsafe/ssz";
import {expect} from "chai";
import sinon from "sinon";
import {SinonStubbedInstance} from "sinon";
import * as stateApiUtils from "../../../../../src/api/impl/beacon/state/utils.js";
import {getDebugApi} from "../../../../../src/api/impl/debug/index.js";
import {INetwork, Network} from "../../../../../src/network/index.js";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {generateProtoBlock} from "../../../../utils/block.js";
import {StubbedBeaconDb} from "../../../../utils/stub/index.js";
import {generateState} from "../../../../utils/state.js";
import {setupApiImplTestServer} from "../index.test.js";
import {SinonStubFn} from "../../../../utils/types.js";

// TODO remove stub
describe.skip("api - debug - beacon", function () {
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
    forkchoiceStub = sinon.createStubInstance(ForkChoice);
    chainStub.forkChoice = forkchoiceStub;
    dbStub = new StubbedBeaconDb();
    networkStub = sinon.createStubInstance(Network);
    debugApi = getDebugApi({chain: chainStub, db: dbStub, config, network: networkStub});
  });

  afterEach(function () {
    resolveStateIdStub.restore();
  });

  it("getHeads - should return head", async function () {
    forkchoiceStub.getHeads.returns([generateProtoBlock({slot: 1000})]);
    const {data: heads} = await debugApi.getHeads();
    expect(heads).to.be.deep.equal([{slot: 1000, root: toHexString(ZERO_HASH)}]);
  });

  it("getState - should return state", async function () {
    resolveStateIdStub.resolves(generateState());
    const {data: state} = await debugApi.getState("something");
    expect(state).to.not.be.null;
  });

  it("getState - should be able to convert to json", async function () {
    resolveStateIdStub.resolves(generateState());
    const {data: state} = await debugApi.getState("something");
    expect(() => ssz.phase0.BeaconState.toJson(state as phase0.BeaconState)).to.not.throw();
  });

  it("getStateV2 - should be able to convert to json", async function () {
    resolveStateIdStub.resolves(generateState({}, minimalConfig, true));
    const {data: state} = await debugApi.getStateV2("something");
    expect(() => ssz.altair.BeaconState.toJson(state as altair.BeaconState)).to.not.throw();
  });
});
