import {BeaconApi} from "../../../../../src/api/impl/beacon";
import sinon from "sinon";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {generateState} from "../../../../utils/state";
import {setupApiImplTestServer, ApiImplTestModules} from "../index.test";

describe("beacon api implementation", function () {
  let api: BeaconApi;
  let dbStub: StubbedBeaconDb;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
    dbStub = new StubbedBeaconDb(sinon);
    api = new BeaconApi(
      {},
      {
        config,
        chain: server.chainStub,
        db: dbStub,
        network: server.networkStub,
        sync: server.syncStub,
      }
    );
  });

  describe("getGenesis", function () {
    it("genesis has not yet occured", async function () {
      server.chainStub.getHeadState.returns(undefined as any);
      const genesis = await api.getGenesis();
      expect(genesis).to.be.null;
    });

    it("success", async function () {
      server.chainStub.getHeadState.returns(generateState());
      const genesis = await api.getGenesis();
      if (!genesis) throw Error("Genesis is nullish");
      expect(genesis.genesisForkVersion).to.not.be.undefined;
      expect(genesis.genesisTime).to.not.be.undefined;
      expect(genesis.genesisValidatorsRoot).to.not.be.undefined;
    });
  });
});
