/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {getBeaconApi} from "../../../../../src/api/impl/beacon";
import sinon from "sinon";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {setupApiImplTestServer, ApiImplTestModules} from "../index.test";

describe("beacon api implementation", function () {
  let dbStub: StubbedBeaconDb;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
    dbStub = new StubbedBeaconDb(sinon);
  });

  describe("getGenesis", function () {
    it("success", async function () {
      const api = getBeaconApi({
        config,
        chain: server.chainStub,
        db: dbStub,
        network: server.networkStub,
      });

      /** eslint-disable @typescript-eslint/no-unsafe-member-access */
      (server.chainStub as any).genesisTime = 0;
      (server.chainStub as any).genesisValidatorsRoot = Buffer.alloc(32);
      const genesis = await api.getGenesis();
      if (!genesis.data) throw Error("Genesis is nullish");
      expect(genesis.data.genesisForkVersion).to.not.be.undefined;
      expect(genesis.data.genesisTime).to.not.be.undefined;
      expect(genesis.data.genesisValidatorsRoot).to.not.be.undefined;
    });
  });
});
