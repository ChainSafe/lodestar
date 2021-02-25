import {config} from "@chainsafe/lodestar-config/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {IBeaconSync} from "../../../../../src/sync/interface";
import {IApiModules} from "../../../../../src/api/impl/interface";
import {ValidatorApi} from "../../../../../src/api/impl/validator/validator";
import {IBeaconChain} from "../../../../../src/chain";
import {BeaconChain} from "../../../../../src/chain/chain";
import {IEth1ForBlockProduction} from "../../../../../src/eth1";
import {Eth1ForBlockProduction} from "../../../../../src/eth1/eth1ForBlockProduction";
import {INetwork} from "../../../../../src/network/interface";
import {Network} from "../../../../../src/network/network";
import {BeaconSync} from "../../../../../src/sync/sync";
import {testLogger} from "../../../../utils/logger";
import {StubbedBeaconDb} from "../../../../utils/stub/beaconDb";
import chaiAsPromised from "chai-as-promised";
import {use, expect} from "chai";

use(chaiAsPromised);

describe("api - validator - produceAttestationData", function () {
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let dbStub: StubbedBeaconDb;
  let eth1Stub: SinonStubbedInstance<IEth1ForBlockProduction>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;

  let modules!: IApiModules;

  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    dbStub = new StubbedBeaconDb(sinon);
    eth1Stub = sinon.createStubInstance(Eth1ForBlockProduction);
    networkStub = sinon.createStubInstance(Network);
    syncStub = sinon.createStubInstance(BeaconSync);
    modules = {
      chain: chainStub,
      config,
      db: dbStub,
      eth1: eth1Stub,
      logger: testLogger(),
      network: networkStub,
      sync: syncStub,
    };
  });

  it("not synced", async function () {
    syncStub.getSyncStatus.returns({syncDistance: BigInt(300), headSlot: BigInt(0)});
    const api = new ValidatorApi({}, modules);
    await expect(api.produceAttestationData(0, 0)).to.be.rejectedWith("Node is syncing");
  });
});
