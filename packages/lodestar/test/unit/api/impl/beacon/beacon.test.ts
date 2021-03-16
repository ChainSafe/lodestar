import {BeaconApi} from "../../../../../src/api/impl/beacon";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {BeaconSync, IBeaconSync} from "../../../../../src/sync";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {generateCachedState} from "../../../../utils/state";
import {Network} from "../../../../../src/network/network";

describe.only("beacon api implementation", function () {
  let api: BeaconApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let dbStub: StubbedBeaconDb;
  let syncStub: SinonStubbedInstance<IBeaconSync>;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    dbStub = new StubbedBeaconDb(sinon);
    syncStub = sinon.createStubInstance(BeaconSync);
    api = new BeaconApi(
      {},
      {
        config,
        chain: chainStub,
        db: dbStub,
        network: sinon.createStubInstance(Network),
        sync: syncStub,
      }
    );
  });

  describe("getGenesis", function () {
    it("success", async function () {
      (chainStub as any).genesisTime = 0;
      (chainStub as any).genesisValidatorsRoot = Buffer.alloc(32);
      const genesis = await api.getGenesis();
      if (!genesis) throw Error("Genesis is nullish");
      expect(genesis.genesisForkVersion).to.not.be.undefined;
      expect(genesis.genesisTime).to.not.be.undefined;
      expect(genesis.genesisValidatorsRoot).to.not.be.undefined;
    });
  });
});
