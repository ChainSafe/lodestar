/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {BeaconApi} from "../../../../../src/api/impl/beacon";
import sinon from "sinon";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
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
    it("success", async function () {
      /** eslint-disable @typescript-eslint/no-unsafe-member-access */
      (server.chainStub as any).genesisTime = 0;
      (server.chainStub as any).genesisValidatorsRoot = Buffer.alloc(32);
      const genesis = await api.getGenesis();
      if (!genesis) throw Error("Genesis is nullish");
      expect(genesis.genesisForkVersion).to.not.be.undefined;
      expect(genesis.genesisTime).to.not.be.undefined;
      expect(genesis.genesisValidatorsRoot).to.not.be.undefined;
    });
  });
});
