import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state/state";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {BeaconChain} from "../../../../../../src/chain";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import sinon, {SinonStub} from "sinon";
import {IBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/interface";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateState} from "../../../../../utils/state";
import {expect} from "chai";

describe("beacon api impl - states", function () {

  let api: IBeaconStateApi;
  let resolveStateIdStub: SinonStub;

  beforeEach(function () {
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    api = new BeaconStateApi({}, {
      config,
      chain: sinon.createStubInstance(BeaconChain),
      db: new StubbedBeaconDb(sinon, config)
    });
  });

  afterEach(function () {
    resolveStateIdStub.restore();
  });

  it("should get state by id", async function () {
    resolveStateIdStub.resolves(generateState());
    const state = await api.getState("something");
    expect(state).to.not.be.null;
  });

  it("state doesn't exist", async function () {
    resolveStateIdStub.resolves(null);
    const state = await api.getState("something");
    expect(state).to.be.null;
  });

});
