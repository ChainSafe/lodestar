import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {SinonStubbedInstance} from "sinon";
import {ILodestarApi, LodestarApi} from "../../../../../src/api/impl/lodestar";
import {BeaconChain} from "../../../../../src/chain";
import {generateState} from "../../../../utils/state";
import {ApiImplTestModules, setupApiImplTestServer} from "../index.test";

describe("Lodestar api impl", function () {
  let api: ILodestarApi;
  let server: ApiImplTestModules;
  let chainStub: SinonStubbedInstance<BeaconChain>;

  beforeEach(async function () {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    chainStub.getHeadState.returns(createCachedBeaconState(config, generateState()));
    api = new LodestarApi({config, chain: chainStub, sync: server.syncStub});
  });

  it("should get latest weak subjectivity checkpoint epoch", async function () {
    const epoch = await api.getLatestWeakSubjectivityCheckpointEpoch();
    expect(epoch).to.be.equal(0);
  });
});
