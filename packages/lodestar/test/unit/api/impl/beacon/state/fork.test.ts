import {BeaconStateApi} from "../../../../../../src/api/impl/beacon/state/state";
import {config} from "@chainsafe/lodestar-config/minimal";
import {BeaconChain} from "../../../../../../src/chain";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import sinon, {SinonStubbedMember} from "sinon";
import {IBeaconStateApi} from "../../../../../../src/api/impl/beacon/state/interface";
import * as stateApiUtils from "../../../../../../src/api/impl/beacon/state/utils";
import {generateState} from "../../../../../utils/state";
import {expect} from "chai";

describe("beacon api impl - state - get fork", function () {
  let api: IBeaconStateApi;
  let resolveStateIdStub: SinonStubbedMember<typeof stateApiUtils["resolveStateId"]>;

  beforeEach(function () {
    resolveStateIdStub = sinon.stub(stateApiUtils, "resolveStateId");
    api = new BeaconStateApi(
      {},
      {
        config,
        chain: sinon.createStubInstance(BeaconChain),
        db: new StubbedBeaconDb(sinon, config),
      }
    );
  });

  afterEach(function () {
    resolveStateIdStub.restore();
  });

  it("should get fork by state id", async function () {
    resolveStateIdStub.resolves({
      state: generateState(),
    });
    const fork = await api.getFork("something");
    expect(fork).to.not.be.null;
  });

  it("state doesn't exist", async function () {
    resolveStateIdStub.resolves(null);
    const fork = await api.getFork("something");
    expect(fork).to.be.null;
  });
});
