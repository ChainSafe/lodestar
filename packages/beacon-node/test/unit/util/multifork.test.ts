import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  CachedBeaconStateAllForks,
  PubkeyIndexMap,
  createCachedBeaconState,
  processSlots,
  stateTransition,
} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultChainConfig} from "@lodestar/config/default";
import {allForks} from "@lodestar/types";
import {getStateTypeFromBytes} from "../../../src/util/multifork.js";
import {BeaconDb} from "../../../src/db/index.js";
import {LevelDbController} from "@lodestar/db";
import {defaultDbOptions} from "../../../src/db/options.js";
import {testLogger} from "../../utils/logger.js";
import {expect} from "chai";

describe("external memory leak", function () {
  this.timeout(0);
  const finalizedSlot = 6543072;
  const folder = `/Users/tuyennguyen/Downloads/state_${finalizedSlot}`;

  it("deserialize state", async function () {
    const data = fs.readFileSync(path.join(folder, "state_mainnet_finalized.ssz"));
    console.log("@@@ number of bytes", data.length);
    const rawState = getStateTypeFromBytes(defaultChainConfig, data).deserializeToViewDU(data);
    console.log("@@@ Got state slot", rawState.slot);
    const config = createBeaconConfig(defaultChainConfig, rawState.genesisValidatorsRoot);

    const db = new BeaconDb({
      config,
      controller: new LevelDbController(defaultDbOptions, {metrics: null, logger: testLogger()}),
    });

    await db.start();

    const state = createCachedBeaconState(rawState, {
      config,
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    });

    const blocks: allForks.SignedBeaconBlock[] = [];
    for (let j = 0; j < SLOTS_PER_EPOCH; j++) {
      const bytes = fs.readFileSync(path.join(folder, `block_${j + finalizedSlot}.ssz`));
      const slot = finalizedSlot + j;
      const json = JSON.parse(bytes.toString());
      const block = config.getForkTypes(slot).SignedBeaconBlock.fromJson((json as {data: any}).data);
      blocks.push(block);
      console.log("@@@ loaded block", block.message.slot);
    }
    console.log("@@@ number of blocks", blocks.length);

    let storedSlot = finalizedSlot;
    for (let i = 0; i < 1e3; i++) {
      const start = Date.now();
      const memory = process.memoryUsage();
      console.log("@@@ rss ", i, memory.rss / 1e6, "MB");
      const clonedState = state.clone() as CachedBeaconStateAllForks;
      let postState = clonedState;
      for (let j = 1; j < SLOTS_PER_EPOCH; j++) {
        postState = stateTransition(postState, blocks[j]);
      }
      storedSlot++;
      postState = processSlots(postState, finalizedSlot + SLOTS_PER_EPOCH);
      await db.stateArchive.put(storedSlot, postState);
    }
  });

  it.only("query stored slots and batch delete", async function () {
    const db = new BeaconDb({
      config: defaultChainConfig,
      controller: new LevelDbController(defaultDbOptions, {metrics: null, logger: testLogger()}),
    });

    await db.start();
    const stateBytes = fs.readFileSync(path.join(folder, "state_mainnet_finalized.ssz"));
    console.log("@@@ stateBytes", stateBytes.length);
    const frequency = 16;

    for (let i = 0; i < 1e6; i++) {
      const start = Date.now();
      const memory = process.memoryUsage();
      console.log("@@@ rss ", i, memory.rss / 1e6, "MB");

      const startSlot = i * frequency + finalizedSlot;
      for (let j = 0; j < frequency; j++) {
        await db.stateArchive.putBinary(startSlot + j, crypto.randomBytes(stateBytes.length));
      }
      console.log("Persisted mock states in", Date.now() - start);
      const storedStateSlots = await db.stateArchive.keys({
        lt: startSlot + frequency,
        // gte: startSlot,
        // keep 1 state in LevelDB
        gt: startSlot,
      });
      console.log("Get stored slots as keys in", Date.now() - start, "num slots", storedStateSlots.length);
      await db.stateArchive.batchDelete(storedStateSlots);
      console.log(`@@@ Finish round ${i} in`, Date.now() - start);
    }
  });

  it("encodeKey and decodeKey", async function () {
    const db = new BeaconDb({
      config: defaultChainConfig,
      controller: new LevelDbController(defaultDbOptions, {metrics: null, logger: testLogger()}),
    });

    await db.start();

    let startSlot = finalizedSlot;
    for (let i = 0; i < 1e6; i++) {
      const memory = process.memoryUsage();
      console.log("@@@ rss ", i, memory.rss / 1e6, "MB");
      for (let j = 0; j < 1e5; j++) {
        startSlot++;
        const rawKey = db.stateArchive.encodeKey(startSlot);
        expect(db.stateArchive.decodeKey(rawKey)).to.be.equal(startSlot);
      }
    }
  });
});
