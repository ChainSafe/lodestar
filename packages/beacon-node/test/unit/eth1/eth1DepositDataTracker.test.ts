import {expect} from "chai";
import sinon from "sinon";
import {config} from "@lodestar/config/default";
import {TimeoutError} from "@lodestar/utils";

import {Eth1DepositDataTracker} from "../../../src/eth1/eth1DepositDataTracker.js";
import {Eth1Provider} from "../../../src/eth1/provider/eth1Provider.js";
import {testLogger} from "../../utils/logger.js";
import {defaultEth1Options} from "../../../src/eth1/options.js";
import {BeaconDb} from "../../../src/db/beacon.js";

describe("Eth1DepositDataTracker", function () {
  const sandbox = sinon.createSandbox();
  const controller = new AbortController();

  const logger = testLogger();
  const opts = {...defaultEth1Options, enabled: false};
  const signal = controller.signal;
  const eth1Provider = new Eth1Provider(config, opts, signal, null);
  const db = sinon.createStubInstance(BeaconDb);

  const eth1DepositDataTracker = new Eth1DepositDataTracker(
    opts,
    {config, db, logger, signal, metrics: null},
    eth1Provider
  );
  sinon
    .stub(
      (eth1DepositDataTracker as never) as {
        getLastProcessedDepositBlockNumber: typeof eth1DepositDataTracker["getLastProcessedDepositBlockNumber"];
      },
      "getLastProcessedDepositBlockNumber"
    )
    .resolves(0);

  sinon.stub(eth1DepositDataTracker["eth1DataCache"], "getHighestCachedBlockNumber").resolves(0);
  sinon.stub(eth1DepositDataTracker["eth1DataCache"], "add").resolves(void 0);

  sinon.stub(eth1DepositDataTracker["depositsCache"], "getEth1DataForBlocks").resolves([]);
  sinon.stub(eth1DepositDataTracker["depositsCache"], "add").resolves(void 0);
  sinon.stub(eth1DepositDataTracker["depositsCache"], "getLowestDepositEventBlockNumber").resolves(0);

  const getBlocksByNumberStub = sinon.stub(eth1Provider, "getBlocksByNumber");
  const getDepositEventsStub = sinon.stub(eth1Provider, "getDepositEvents");

  after(() => {
    sandbox.restore();
  });

  it("Should dynamically adjust blocks batch size", async function () {
    let expectedSize = 1000;
    expect(eth1DepositDataTracker["eth1GetBlocksBatchSizeDynamic"]).to.be.equal(expectedSize);

    // If there are timeerrors or parse errors then batch size should reduce
    getBlocksByNumberStub.throws(new TimeoutError("timeout error"));
    for (let i = 0; i < 10; i++) {
      expectedSize = Math.max(Math.floor(expectedSize / 2), 10);
      await eth1DepositDataTracker["updateBlockCache"](3000).catch((_e) => void 0);
      expect(eth1DepositDataTracker["eth1GetBlocksBatchSizeDynamic"]).to.be.equal(expectedSize);
    }
    expect(expectedSize).to.be.equal(10);

    getBlocksByNumberStub.resolves([]);
    // Should take a whole longer to get back to the orignal batch size
    for (let i = 0; i < 100; i++) {
      expectedSize = Math.min(expectedSize + 10, 1000);
      await eth1DepositDataTracker["updateBlockCache"](3000);
      expect(eth1DepositDataTracker["eth1GetBlocksBatchSizeDynamic"]).to.be.equal(expectedSize);
    }
    expect(expectedSize).to.be.equal(1000);
  });

  it("Should dynamically adjust logs batch size", async function () {
    let expectedSize = 1000;
    expect(eth1DepositDataTracker["eth1GetLogsBatchSizeDynamic"]).to.be.equal(expectedSize);

    // If there are timeerrors or parse errors then batch size should reduce
    getDepositEventsStub.throws(new TimeoutError("timeout error"));
    for (let i = 0; i < 10; i++) {
      expectedSize = Math.max(Math.floor(expectedSize / 2), 10);
      await eth1DepositDataTracker["updateDepositCache"](3000).catch((_e) => void 0);
      expect(eth1DepositDataTracker["eth1GetLogsBatchSizeDynamic"]).to.be.equal(expectedSize);
    }
    expect(expectedSize).to.be.equal(10);

    getDepositEventsStub.resolves([]);
    // Should take a whole longer to get back to the orignal batch size
    for (let i = 0; i < 100; i++) {
      expectedSize = Math.min(expectedSize + 10, 1000);
      await eth1DepositDataTracker["updateDepositCache"](3000);
      expect(eth1DepositDataTracker["eth1GetLogsBatchSizeDynamic"]).to.be.equal(expectedSize);
    }
    expect(expectedSize).to.be.equal(1000);
  });
});
