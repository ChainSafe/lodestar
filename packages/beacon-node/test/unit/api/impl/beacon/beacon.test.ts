/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {getBeaconApi} from "../../../../../src/api/impl/beacon/index.js";
import {StubbedBeaconDb} from "../../../../utils/stub/index.js";
import {setupApiImplTestServer, ApiImplTestModules} from "../index.test.js";
import {testLogger} from "../../../../utils/logger.js";

describe("beacon api implementation", function () {
  const logger = testLogger();
  let dbStub: StubbedBeaconDb;
  let server: ApiImplTestModules;

  before(function () {
    server = setupApiImplTestServer();
    dbStub = new StubbedBeaconDb();
  });

  describe("getGenesis", function () {
    it("success", async function () {
      const api = getBeaconApi({
        config,
        chain: server.chainStub,
        db: dbStub,
        logger,
        network: server.networkStub,
        metrics: null,
      });

      /** eslint-disable @typescript-eslint/no-unsafe-member-access */
      (server.chainStub as any).genesisTime = 0;
      (server.chainStub as any).genesisValidatorsRoot = Buffer.alloc(32);
      const {data: genesis} = await api.getGenesis();
      if (genesis === null || genesis === undefined) throw Error("Genesis is nullish");
      expect(genesis.genesisForkVersion).to.not.be.undefined;
      expect(genesis.genesisTime).to.not.be.undefined;
      expect(genesis.genesisValidatorsRoot).to.not.be.undefined;
    });
  });
});
