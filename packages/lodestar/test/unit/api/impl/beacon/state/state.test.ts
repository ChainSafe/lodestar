import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state/state";
import {config} from "@chainsafe/lodestar-config/minimal";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import sinon from "sinon";
import {IBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/interface";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateState} from "../../../../../utils/state";
import {expect} from "chai";
import {ApiImplTestModules, setupApiImplTestServer} from "../../index.test";
import {SinonStubFn} from "../../../../../utils/types";

describe("beacon api impl - states", function () {
  let api: IBeaconStateApi;
  let resolveStateIdStub: SinonStubFn<typeof stateApiUtils["resolveStateId"]>;
  let getEpochBeaconCommitteesStub: SinonStubFn<typeof stateApiUtils["getEpochBeaconCommittees"]>;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
  });

  beforeEach(function () {
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    getEpochBeaconCommitteesStub = sinon.stub(stateApiUtils, "getEpochBeaconCommittees");
    api = new BeaconStateApi(
      {},
      {
        config,
        chain: server.chainStub,
        db: new StubbedBeaconDb(sinon, config),
      }
    );
  });

  afterEach(function () {
    resolveStateIdStub.restore();
    getEpochBeaconCommitteesStub.restore();
  });

  describe("getState", function () {
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

  describe("getStateCommittes", function () {
    it("no state context", async function () {
      resolveStateIdStub.resolves(null);
      await expect(api.getStateCommittees("blem")).to.be.eventually.rejectedWith("State not found");
    });

    const state = generateState();

    it("no filters", async function () {
      resolveStateIdStub.resolves(state);
      getEpochBeaconCommitteesStub.returns([[[1, 4, 5]], [[2, 3, 6]]]);
      const committees = await api.getStateCommittees("blem");
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
      const committees = await api.getStateCommittees("blem", {slot: 1, index: 1});
      expect(committees).to.have.length(1);
      expect(committees[0].index).to.be.equal(1);
      expect(committees[0].slot).to.be.equal(1);
      expect(committees[0].validators).to.be.deep.equal([8, 9, 10]);
    });
  });
});
