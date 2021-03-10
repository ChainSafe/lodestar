import {config} from "@chainsafe/lodestar-config/minimal";
import {SinonStubbedInstance} from "sinon";
import {IBeaconSync} from "../../../../../src/sync/interface";
import {IApiModules} from "../../../../../src/api/impl/interface";
import {ValidatorApi} from "../../../../../src/api/impl/validator/validator";
import {IEth1ForBlockProduction} from "../../../../../src/eth1";
import {testLogger} from "../../../../utils/logger";
import chaiAsPromised from "chai-as-promised";
import {use, expect} from "chai";

use(chaiAsPromised);

describe("api - validator - produceAttestationData", function () {
  let eth1Stub: SinonStubbedInstance<IEth1ForBlockProduction>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let modules!: IApiModules;

  beforeEach(function () {
    syncStub = this.test?.ctx?.syncStub;
    modules = {
      chain: this.test?.ctx?.chainStub,
      config,
      db: this.test?.ctx?.dbStub,
      eth1: eth1Stub,
      logger: testLogger(),
      network: this.test?.ctx?.networkStub,
      sync: syncStub,
    };
  });

  it("not synced", async function () {
    syncStub.getSyncStatus.returns({syncDistance: BigInt(300), headSlot: BigInt(0)});
    const api = new ValidatorApi({}, modules);
    await expect(api.produceAttestationData(0, 0)).to.be.rejectedWith("Node is syncing");
  });
});
