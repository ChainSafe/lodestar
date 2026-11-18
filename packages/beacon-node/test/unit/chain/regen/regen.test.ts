import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {aggregateSerializedPublicKeys} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SIZE,
} from "@lodestar/params";
import {
  BeaconStateView,
  IBeaconStateView,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createBeaconStateViewForHistoricalRegen,
  interopSecretKey,
  isStatePostAltair,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEvent, ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {RegenCaller} from "../../../../src/chain/regen/interface.js";
import {processSlotsToNearestCheckpoint} from "../../../../src/chain/regen/regen.js";
import {FIFOBlockStateCache} from "../../../../src/chain/stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache} from "../../../../src/chain/stateCache/persistentCheckpointsCache.js";
import {getTestDatastore} from "../../../utils/chain/stateCache/datastore.js";
import {generateCachedState} from "../../../utils/state.js";

describe("regen", () => {
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
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
          return new BeaconStateView(state);
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
        return new BeaconStateView(state);
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
          config,
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

      const modules = {
        config,
        checkpointStateCache: cache,
        metrics: null,
        validatorMonitor: null,
        emitter: null,
        logger: null,
      };
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

      const modules = {
        config,
        checkpointStateCache: cache,
        metrics: null,
        validatorMonitor: null,
        emitter: null,
        logger: null,
      };
      const preState = states["cp0b"];
      await processSlotsToNearestCheckpoint(modules, preState, startSlotEpoch22, RegenCaller.processBlocksInEpoch, {
        dontTransferCache: true,
      });

      // there are 2 epoch transitions, so the checkpoint states of epoch 20 should be pruned
      expect(fileApisBuffer.size).toEqual(1);
    });
  });

  describe("finalized pubkey promotion during skipped epochs", () => {
    afterEach(() => pubkeyCache.reset());

    it.each([false, true])("promotes before a candidate activates (native=%s)", async (nativeStateTransition) => {
      pubkeyCache.reset();
      const config = createBeaconConfig(getConfig(ForkName.altair), new Uint8Array(32));
      const value = ssz.altair.BeaconState.defaultValue();
      value.slot = 252 * SLOTS_PER_EPOCH - 1;
      value.latestBlockHeader.slot = value.slot;
      value.fork = {
        previousVersion: config.GENESIS_FORK_VERSION,
        currentVersion: config.ALTAIR_FORK_VERSION,
        epoch: 0,
      };
      value.validators = Array.from({length: 65}, (_, index) => ({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey: interopSecretKey(index).toPublicKey().toBytes(),
        effectiveBalance: 32e9,
        activationEligibilityEpoch: index === 64 ? 250 : 0,
        activationEpoch: index === 64 ? FAR_FUTURE_EPOCH : 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }));
      value.balances = value.validators.map(() => 32e9);
      value.previousEpochParticipation = value.validators.map((_, index) => (index < 64 ? 7 : 0));
      value.currentEpochParticipation = [...value.previousEpochParticipation];
      value.inactivityScores = value.validators.map(() => 0);
      value.finalizedCheckpoint.epoch = 249;
      value.currentJustifiedCheckpoint.epoch = 250;
      value.previousJustifiedCheckpoint.epoch = 249;
      for (let index = 0; index < 4; index++) value.justificationBits.set(index, true);
      value.currentSyncCommittee.pubkeys = Array.from(
        {length: SYNC_COMMITTEE_SIZE},
        (_, index) => value.validators[index % 64].pubkey
      );
      value.currentSyncCommittee.aggregatePubkey = aggregateSerializedPublicKeys(
        value.currentSyncCommittee.pubkeys
      ).toBytes();
      value.nextSyncCommittee = value.currentSyncCommittee;
      pubkeyCache.syncPubkeys(value.validators.slice(0, 64));
      const preState = createBeaconStateViewForHistoricalRegen({
        config,
        nativeStateTransition,
        stateBytes: ssz.altair.BeaconState.serialize(value),
      });
      const cache = new PersistentCheckpointStateCache(
        {
          config,
          datastore: getTestDatastore(new Map()),
          logger: testLogger(),
          blockStateCache: new FIFOBlockStateCache({}, {}),
        },
        {maxCPStateEpochsInMemory: 8}
      );
      const chain = {
        pubkeyCache,
        pubkeyCacheFinalizedEpoch: 249,
        promoteFinalizedPubkeys: BeaconChain.prototype.promoteFinalizedPubkeys,
        shufflingCache: {processState: vi.fn()},
      };
      const emitter = new ChainEventEmitter();
      emitter.on(ChainEvent.checkpoint, BeaconChain.prototype["onCheckpoint"].bind(chain as unknown as BeaconChain));
      const boundaries: {epoch: number; finalizedEpoch: number; activationEpoch: number; denseSize: number}[] = [];
      emitter.on(ChainEvent.checkpoint, (checkpoint, state) => {
        boundaries.push({
          epoch: checkpoint.epoch,
          finalizedEpoch: state.finalizedCheckpoint.epoch,
          activationEpoch: state.getValidator(64).activationEpoch,
          denseSize: pubkeyCache.size,
        });
      });
      let postState: IBeaconStateView | undefined;
      try {
        expect(pubkeyCache.size).toBe(64);
        postState = await processSlotsToNearestCheckpoint(
          {config, checkpointStateCache: cache, emitter, metrics: null, validatorMonitor: null, logger: null},
          preState,
          256 * SLOTS_PER_EPOCH,
          RegenCaller.validateGossipBlock,
          {dontTransferCache: true}
        );
        expect(boundaries[0]).toEqual({epoch: 252, finalizedEpoch: 250, activationEpoch: 256, denseSize: 65});
        expect(boundaries).toHaveLength(5);
        expect(chain.pubkeyCacheFinalizedEpoch).toBe(250);
        expect(pubkeyCache.getPubkeyBytes(64)).toEqual(value.validators[64].pubkey);
        expect(pubkeyCache.getCandidates(value.validators[64].pubkey)).toEqual([]);
        expect(isStatePostAltair(postState)).toBe(true);
        if (!isStatePostAltair(postState)) throw Error("expected Altair state");
        expect(
          postState.nextSyncCommittee.pubkeys.some((pubkey) => byteArrayEquals(pubkey, value.validators[64].pubkey))
        ).toBe(true);
        for (const index of postState.currentProposers) {
          expect(pubkeyCache.getPubkeyBytes(index), `wrong key for proposer ${index}`).toEqual(
            postState.getValidator(index).pubkey
          );
        }
      } finally {
        preState.release();
        for (const state of cache.getStates()) state.release();
        await cache.clear();
      }
    });
  });
});
