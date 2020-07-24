import {BeaconApi} from "../../../../../src/api/impl/beacon";
import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {BeaconSync, IBeaconSync} from "../../../../../src/sync";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";
import {generateState} from "../../../../utils/state";

describe("beacon api implementation", function () {

  let api: BeaconApi;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let dbStub: StubbedBeaconDb;
  let syncStub: SinonStubbedInstance<IBeaconSync>;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    dbStub = new StubbedBeaconDb(sinon, config);
    syncStub = sinon.createStubInstance(BeaconSync);
    api = new BeaconApi({}, {
      config,
      chain: chainStub,
      db: dbStub,
      sync: syncStub
    });
  });

  describe("getGenesis", function () {

    it("genesis has not yet occured", async function () {
      chainStub.getHeadState.resolves(null);
      const genesis = await api.getGenesis();
      expect(genesis).to.be.null;
    });

    it("success", async function () {
      chainStub.getHeadState.resolves(generateState());
      const genesis = await api.getGenesis();
      expect(genesis).to.not.be.null;
      expect(genesis).to.not.be.undefined;
      expect(genesis.genesisForkVersion).to.not.be.undefined;
      expect(genesis.genesisTime).to.not.be.undefined;
      expect(genesis.genesisValidatorsRoot).to.not.be.undefined;
    });

  });

});
