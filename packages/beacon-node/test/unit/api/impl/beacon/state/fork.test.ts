import sinon, {SinonStubbedMember} from "sinon";
import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/index.js";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils.js";
import {generateCachedState} from "../../../../../utils/state.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test.js";

// TODO remove stub
describe.skip("beacon api impl - state - get fork", function () {
  let api: ReturnType<typeof getBeaconStateApi>;
  let resolveStateIdStub: SinonStubbedMember<typeof stateApiUtils["resolveStateId"]>;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
  });

  beforeEach(function () {
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    api = getBeaconStateApi({
      config,
      chain: server.chainStub,
      db: server.dbStub,
    });
  });

  afterEach(function () {
    resolveStateIdStub.restore();
  });

  it("should get fork by state id", async function () {
    resolveStateIdStub.resolves({state: generateCachedState(), executionOptimistic: false});
    const {data: fork} = await api.getStateFork("something");
    expect(fork).to.not.be.null;
  });
});
