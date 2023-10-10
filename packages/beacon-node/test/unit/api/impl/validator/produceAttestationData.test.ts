import sinon, {SinonStubbedInstance} from "sinon";
import chaiAsPromised from "chai-as-promised";
import {use, expect} from "chai";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {IBeaconSync, SyncState} from "../../../../../src/sync/interface.js";
import {ApiModules} from "../../../../../src/api/impl/types.js";
import {getValidatorApi} from "../../../../../src/api/impl/validator/index.js";
import {IClock} from "../../../../../src/util/clock.js";
import {testLogger} from "../../../../utils/logger.js";
import {ApiImplTestModules, setupApiImplTestServer} from "../index.test.js";

use(chaiAsPromised);

describe("api - validator - produceAttestationData", function () {
  const logger = testLogger();
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let modules: ApiModules;
  let server: ApiImplTestModules;

  beforeEach(function () {
    server = setupApiImplTestServer();
    syncStub = server.syncStub;
    modules = {
      chain: server.chainStub,
      config,
      db: server.dbStub,
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
    server.chainStub.clock = {currentSlot} as IClock;
    sinon.replaceGetter(syncStub, "state", () => SyncState.SyncingFinalized);
    server.forkChoiceStub.getHead.returns({slot: headSlot} as ProtoBlock);

    // Should not allow any call to validator API
    const api = getValidatorApi(modules);
    await expect(api.produceAttestationData(0, 0)).to.be.rejectedWith("Node is syncing");
  });

  it("Should throw error when node is stopped", async function () {
    const currentSlot = 100000;
    server.chainStub.clock = {currentSlot} as IClock;
    sinon.replaceGetter(syncStub, "state", () => SyncState.Stalled);

    // Should not allow any call to validator API
    const api = getValidatorApi(modules);
    await expect(api.produceAttestationData(0, 0)).to.be.rejectedWith("Node is syncing - waiting for peers");
  });
});
