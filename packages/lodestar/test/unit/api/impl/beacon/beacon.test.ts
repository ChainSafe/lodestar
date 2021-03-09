import {BeaconApi} from "../../../../../src/api/impl/beacon";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {BeaconSync, IBeaconSync} from "../../../../../src/sync";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import {generateState} from "../../../../utils/state";
import {Network} from "../../../../../src/network/network";

describe("beacon api implementation", function () {
  let api: BeaconApi;
  let chainStubz: SinonStubbedInstance<IBeaconChain>;
  let dbStub: StubbedBeaconDb;
  let syncStub: SinonStubbedInstance<IBeaconSync>;

  beforeEach(function () {
    chainStubz = sinon.createStubInstance(BeaconChain);
    dbStub = new StubbedBeaconDb(sinon);
    syncStub = sinon.createStubInstance(BeaconSync);
    api = new BeaconApi(
      {},
      {
        config,
        chain: chainStubz,
        db: dbStub,
        network: sinon.createStubInstance(Network),
        sync: syncStub,
      }
    );
  });

  describe("getGenesis", function () {
    it("genesis has not yet occured", async function () {
      chainStubz.getHeadState.returns(undefined as any);
      const genesis = await api.getGenesis();
      expect(genesis).to.be.null;
    });

    it("success", async function () {
      chainStubz.getHeadState.returns(generateState());
      const genesis = await api.getGenesis();
      if (!genesis) throw Error("Genesis is nullish");
      expect(genesis.genesisForkVersion).to.not.be.undefined;
      expect(genesis.genesisTime).to.not.be.undefined;
      expect(genesis.genesisValidatorsRoot).to.not.be.undefined;
    });
  });
});
