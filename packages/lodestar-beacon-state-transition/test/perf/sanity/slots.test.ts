import {config} from "@chainsafe/lodestar-config/mainnet";
import {BeaconState} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import {expect} from "chai";
import {processSlots} from "../../../src/fast/slot";
import {CachedBeaconState, createCachedBeaconState} from "../../../src/fast/util";
import {generatePerformanceState, initBLS} from "../util";

describe("Process Slots Performance Test", function () {
  this.timeout(0);
  const logger = new WinstonLogger();
  let cachedState: CachedBeaconState;
  let origState: TreeBacked<BeaconState>;

  before(async () => {
    await initBLS();
    origState = await generatePerformanceState();
  });

  beforeEach(() => {
    cachedState = createCachedBeaconState(config, origState.clone());
  });

  it("process 1 empty epoch", async () => {
    const numSlot = 32;
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    processSlots(cachedState, cachedState.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(900, "processing 1 empty epoch takes longer than expected");
  });

  it("process double empty epochs", async () => {
    const numSlot = 64;
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    processSlots(cachedState, cachedState.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(2100, "processing 2 empty epochs takes longer than expected");
  });

  it("process 4 empty epochs", async () => {
    const numSlot = 128;
    logger.profile(`Process ${numSlot} slots`);
    const start = Date.now();
    processSlots(cachedState, cachedState.slot + numSlot);
    logger.profile(`Process ${numSlot} slots`);
    expect(Date.now() - start).lt(3600, "processing 4 empty epochs takes longer than expected");
  });
});
