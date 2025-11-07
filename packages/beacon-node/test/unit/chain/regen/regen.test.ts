import {beforeEach, describe, expect, it} from "vitest";
import {SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RegenCaller} from "../../../../src/chain/regen/interface.js";
import {processSlotsToNearestCheckpoint} from "../../../../src/chain/regen/regen.js";
import {FIFOBlockStateCache} from "../../../../src/chain/stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache} from "../../../../src/chain/stateCache/persistentCheckpointsCache.js";
import {getTestDatastore} from "../../../utils/chain/stateCache/datastore.js";
import {testLogger} from "../../../utils/logger.js";
import {generateCachedState} from "../../../utils/state.js";

describe("regen", () => {
  //
  //     epoch: 19         20           21         22          23
  //            |-----------|-----------|-----------|-----------|
  //                       ^^           ^
  //                       ||           |
  //                       |0b--------root1
  //                       |
  //                       0a
  describe("processSlotsToNearestCheckpoint", () => {
    const fileApisBuffer = new Map();
    const datastore = getTestDatastore(fileApisBuffer);
    const root0a = Buffer.alloc(32);
    const root0b = Buffer.alloc(32, 1);
    const root1 = Buffer.alloc(32, 2);
    // root0a is of the last slot of epoch 19
    const cp0a = {epoch: 20, root: root0a};
    // root0b is of the first slot of epoch 20
    const cp0b = {epoch: 20, root: root0b};
    const cp1 = {epoch: 21, root: root1};

    const startSlotEpoch20 = computeStartSlotAtEpoch(20);
    const startSlotEpoch21 = computeStartSlotAtEpoch(21);
    const startSlotEpoch22 = computeStartSlotAtEpoch(22);

    const allStates = [cp0a, cp0b, cp1]
      .map((cp) => generateCachedState({slot: cp.epoch * SLOTS_PER_EPOCH}))
      .map((state, i) => {
        const stateEpoch = computeEpochAtSlot(state.slot);
        if (stateEpoch === 20 && i === 0) {
          // cp0a
          state.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
          state.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0a);
          return state;
        }

        // other states based on cp0b
        state.blockRoots.set((startSlotEpoch20 - 1) % SLOTS_PER_HISTORICAL_ROOT, root0a);
        state.blockRoots.set(startSlotEpoch20 % SLOTS_PER_HISTORICAL_ROOT, root0b);

        if (stateEpoch >= 21) {
          state.blockRoots.set(startSlotEpoch21 % SLOTS_PER_HISTORICAL_ROOT, root1);
        }
        // if (stateEpoch >= 22) {
        //   state.blockRoots.set(startSlotEpoch22 % SLOTS_PER_HISTORICAL_ROOT, root2);
        // }
        return state;
      });

    const states = {
      // Previous Root Checkpoint State of epoch 20
      cp0a: allStates[0],
      // Current Root Checkpoint State of epoch 20
      cp0b: allStates[1],
      // Current Root Checkpoint State of epoch 21
      cp1: allStates[2],
      // // Current Root Checkpoint State of epoch 22
      // cp2: allStates[3],
    };

    let cache: PersistentCheckpointStateCache;

    beforeEach(() => {
      cache = new PersistentCheckpointStateCache(
        {
          datastore,
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 2}
      );

      cache.add(cp0a, states["cp0a"]);
      cache.add(cp0b, states["cp0b"]);
      cache.add(cp1, states["cp1"]);
    });

    /**
     * PreState is root1 at epoch 21 and dial to epoch 22
     * There are single epoch transitions so it'd not prune/persist states
     */
    it("should not prune checkpoint states when processing a single epoch transition", async () => {
      // no state is persisted at the  beginning
      expect(fileApisBuffer.size).toEqual(0);

      const modules = {checkpointStateCache: cache, metrics: null, validatorMonitor: null, emitter: null, logger: null};
      const preState = states["cp1"];
      await processSlotsToNearestCheckpoint(modules, preState, startSlotEpoch22, RegenCaller.processBlocksInEpoch, {
        dontTransferCache: true,
      });

      // even through there are 3 epochs in memory, no state is pruned/persisted
      // it'll do it at the last 1/3 slot of epoch 22
      expect(fileApisBuffer.size).toEqual(0);
    });

    /**
     * PreState is 0b at epoch 20 and dial to epoch 22
     * There are multiple epoch transitions so it'd prune/persist states if needed
     * There are 3 epochs in memory but maxCPStateEpochsInMemory = 2 so there should be 1 persisted
     */
    it("should prune checkpoint states when processing multiple epoch transitions", async () => {
      // no state is persisted at the  beginning
      expect(fileApisBuffer.size).toEqual(0);

      const modules = {checkpointStateCache: cache, metrics: null, validatorMonitor: null, emitter: null, logger: null};
      const preState = states["cp0b"];
      await processSlotsToNearestCheckpoint(modules, preState, startSlotEpoch22, RegenCaller.processBlocksInEpoch, {
        dontTransferCache: true,
      });

      // there are 2 epoch transitions, so the checkpoint states of epoch 20 should be pruned
      expect(fileApisBuffer.size).toEqual(1);
    });
  });
});
