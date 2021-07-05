import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state";
import {config} from "@chainsafe/lodestar-config/default";
import sinon, {SinonStubbedMember} from "sinon";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateCachedState} from "../../../../../utils/state";
import {expect} from "chai";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";

describe("beacon api impl - state - get fork", function () {
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
    resolveStateIdStub.resolves(generateCachedState());
    const {data: fork} = await api.getStateFork("something");
    expect(fork).to.not.be.null;
  });
});
