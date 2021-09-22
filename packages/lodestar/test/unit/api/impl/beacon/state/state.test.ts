import {getBeaconStateApi} from "../../../../../../src/api/impl/beacon/state";
import {config} from "@chainsafe/lodestar-config/default";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import sinon from "sinon";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateState} from "../../../../../utils/state";
import {expect} from "chai";
import {ApiImplTestModules, setupApiImplTestServer} from "../../index.test";
import {SinonStubFn} from "../../../../../utils/types";

describe("beacon api impl - states", function () {
  let api: ReturnType<typeof getBeaconStateApi>;
  let resolveStateIdStub: SinonStubFn<typeof stateApiUtils["resolveStateId"]>;
  let getEpochBeaconCommitteesStub: SinonStubFn<typeof stateApiUtils["getEpochBeaconCommittees"]>;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
  });

  beforeEach(function () {
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    getEpochBeaconCommitteesStub = sinon.stub(stateApiUtils, "getEpochBeaconCommittees");
    api = getBeaconStateApi({
      config,
      chain: server.chainStub,
      db: new StubbedBeaconDb(config),
    });
  });

  afterEach(function () {
    resolveStateIdStub.restore();
    getEpochBeaconCommitteesStub.restore();
  });

  describe("getEpochCommittees", function () {
    const state = generateState();

    it("no filters", async function () {
      resolveStateIdStub.resolves(state);
      getEpochBeaconCommitteesStub.returns([[[1, 4, 5]], [[2, 3, 6]]]);
      const {data: committees} = await api.getEpochCommittees("blem");
      expect(committees).to.have.length(2);
    });
    it("slot and committee filter", async function () {
      resolveStateIdStub.resolves(state);
      getEpochBeaconCommitteesStub.returns([
        [[1, 4, 5]],
        [
          [2, 3, 6],
          [8, 9, 10],
        ],
      ]);
      const {data: committees} = await api.getEpochCommittees("blem", {slot: 1, index: 1});
      expect(committees).to.have.length(1);
      expect(committees[0].index).to.be.equal(1);
      expect(committees[0].slot).to.be.equal(1);
      expect(committees[0].validators).to.be.deep.equal([8, 9, 10]);
    });
  });
});
