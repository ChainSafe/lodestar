import {config} from "@chainsafe/lodestar-config/minimal";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import sinon, {SinonStubbedInstance} from "sinon";
import {IBeaconSync, SyncState} from "../../../../../src/sync/interface";
import {IApiModules} from "../../../../../src/api/impl/interface";
import {ValidatorApi} from "../../../../../src/api/impl/validator/validator";
import {IEth1ForBlockProduction} from "../../../../../src/eth1";
import {LocalClock} from "../../../../../src/chain/clock";
import {testLogger} from "../../../../utils/logger";
import chaiAsPromised from "chai-as-promised";
import {use, expect} from "chai";
import {ApiImplTestModules, setupApiImplTestServer} from "../index.test";

use(chaiAsPromised);

describe("api - validator - produceAttestationData", function () {
  const logger = testLogger();
  let eth1Stub: SinonStubbedInstance<IEth1ForBlockProduction>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let modules: IApiModules;
  let server: ApiImplTestModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    syncStub = server.syncStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
      eth1: eth1Stub,
      logger,
      network: server.networkStub,
      sync: syncStub,
      metrics: null,
    };
  });

  it("Should throw when node is not synced", async function () {
    // Set the node's state to way back from current slot
    const currentSlot = 100000;
    const headSlot = 0;
    server.chainStub.clock = {currentSlot} as LocalClock;
    sinon.replaceGetter(syncStub, "state", () => SyncState.SyncingFinalized);
    server.forkChoiceStub.getHead.returns({slot: headSlot} as IBlockSummary);

    // Should not allow any call to validator API
    const api = new ValidatorApi({}, modules);
    await expect(api.produceAttestationData(0, 0)).to.be.rejectedWith("Node is syncing");
  });

  it("Should throw error when node is stopped", async function () {
    const currentSlot = 100000;
    server.chainStub.clock = {currentSlot} as LocalClock;
    sinon.replaceGetter(syncStub, "state", () => SyncState.Stalled);

    // Should not allow any call to validator API
    const api = new ValidatorApi({}, modules);
    await expect(api.produceAttestationData(0, 0)).to.be.rejectedWith("Node is waiting for peers");
  });
});
