import crypto from "node:crypto";
import rimraf from "rimraf";
import {LevelDbController} from "@lodestar/db";
import {config as defaultChainConfig} from "@lodestar/config/default";
import {BeaconDb} from "../../../../../src/db/beacon.js";
import {defaultDbOptions} from "../../../../../src/db/options.js";
import {testLogger} from "../../../../utils/logger.js";

/**LODESTAR_PRESET=mainnet ../../node_modules/.bin/mocha test/unit/db/api/repositories/stateArchive.test.ts */
describe("Reproduce RSS spike issue", function () {
  this.timeout(0);

  beforeEach(async () => {
    await rimraf(".tmp");
  });

  it.only("query stored slots and batch delete", async function () {
    const db = new BeaconDb({
      config: defaultChainConfig,
      controller: new LevelDbController(defaultDbOptions, {metrics: null, logger: testLogger()}),
    });

    await db.start();
    // as on mainnet
    const stateBytesLength = 100_000_000;
    const finalizedSlot = 6543072;

    console.log("@@@ stateBytes", stateBytesLength);
    const frequency = 16;

    for (let i = 0; i < 1e6; i++) {
      const start = Date.now();
      const memory = process.memoryUsage();
      console.log("@@@ rss ", i, memory.rss / 1e6, "MB");

      const startSlot = i * frequency + finalizedSlot;
      for (let j = 0; j < frequency; j++) {
        await db.stateArchive.putBinary(startSlot + j, crypto.randomBytes(stateBytesLength));
      }
      const storedStateSlots = await db.stateArchive.keys({
        lt: startSlot + frequency,
        // keep 1 state in LevelDB
        gt: startSlot,
      });
      await db.stateArchive.batchDelete(storedStateSlots);
      console.log("@@@ num slots in db", (await db.stateArchive.keys()).length);
      console.log(`@@@ Finish round ${i} in`, Date.now() - start, "ms");
    }
  });
});
