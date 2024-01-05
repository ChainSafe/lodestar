import fs from "node:fs";
import {describe, it, afterEach, beforeEach, expect} from "vitest";
import {Gauge, Histogram} from "prom-client";
import {ChainConfig} from "@lodestar/config";
import {Slot, phase0} from "@lodestar/types";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {LogLevel, TestLoggerOpts, testLogger} from "../../../utils/logger.js";
import {getDevBeaconNode} from "../../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../../utils/node/validator.js";
import {waitForEvent} from "../../../utils/events/resolver.js";
import {ChainEvent, ReorgEventData} from "../../../../src/chain/emitter.js";
import {ReorgedForkChoice} from "../../../utils/mocks/forkchoice.js";
import {connect} from "../../../utils/network.js";
import {CacheItemType} from "../../../../src/chain/stateCache/types.js";
import {CHECKPOINT_STATES_FOLDER} from "../../../../src/chain/stateCache/datastore/file.js";

/**
 * Test different reorg scenarios to make sure the StateCache implementations are correct.
 */
describe(
  "chain/stateCache/n-historical states",
  function () {
    const validatorCount = 8;
    const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT"> = {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      SECONDS_PER_SLOT: 2,
    };

    beforeEach(async () => {
      await fs.promises.rm(CHECKPOINT_STATES_FOLDER, {recursive: true, force: true});
    });

    const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
    afterEach(async () => {
      while (afterEachCallbacks.length > 0) {
        const callback = afterEachCallbacks.pop();
        if (callback) await callback();
      }
    });

    // all tests run until this slot
    const LAST_SLOT = 33;

    /**
     *                                   (n+1)
     *                     -----------------|
     *                    /
     *         |---------|---------|
     *                   ^         ^
     *                 (n+1-x)   reorgedSlot n
     *                   ^
     *               commonAncestor
     *                   |<--reorgDistance-->|
     */
    const testCases: {
      name: string;
      reorgedSlot: number;
      reorgDistance: number;
      maxBlockStates: number;
      maxCPStateEpochsInMemory: number;
      reloadCount: number;
      persistCount: number;
      numStatesInMemory: number;
      numStatesPersisted: number;
      numEpochsInMemory: number;
      numEpochsPersisted: number;
    }[] = [
      /**
       * Block slot 28 has parent slot 25, block slot 26 and 27 are reorged
       *                        --------------------|---
       *                       /       ^  ^         ^  ^
       *                      /       28  29        32 33
       * |----------------|----------
       *                  ^  ^  ^  ^
       *                 24 25 26  27
       * */
      {
        name: "0 historical state, reorg in same epoch",
        reorgedSlot: 27,
        reorgDistance: 3,
        maxBlockStates: 1,
        maxCPStateEpochsInMemory: 0,
        // reload at cp epoch 1 once to regen state 9 (12 - 3)
        reloadCount: 1,
        // persist for epoch 0 to 4, no need to persist cp epoch 3 again
        persistCount: 5,
        // run through slot 33, no state in memory
        numStatesInMemory: 0,
        // epoch 0 1 2 3 4 but finalized at epoch 2 so store checkpoint states for epoch 2 3 4
        numStatesPersisted: 3,
        numEpochsInMemory: 0,
        // epoch 0 1 2 3 4 but finalized at eopch 2 so store checkpoint states for epoch 2 3 4
        numEpochsPersisted: 3,
        // chain is finalized at epoch 2 end of test
      },
      /**
       * Block slot 28 has parent slot 23, block slot 824 25 26 and 27 are reorged
       *                                   --------------------------|---
       *                                 / |            ^  ^         ^  ^
       *                                /  |           28  29       32  33
       *                  |----------------|----------
       *                 16             ^  ^  ^  ^  ^
       *                  ^            23 24 25 26  27
       *               reload          ^
       *                               2 checkpoint states at epoch 3 are persisted
       */
      {
        name: "0 historical state, reorg 1 epoch",
        reorgedSlot: 27,
        reorgDistance: 5,
        maxBlockStates: 1,
        maxCPStateEpochsInMemory: 0,
        // reload at cp epoch 2 once to regen state 23 (28 - 5)
        reloadCount: 1,
        // 1 cp state for epoch 0 1 2 4, and 2 cp states for epoch 3 (different roots)
        persistCount: 6,
        numStatesInMemory: 0,
        // epoch 0 1 2 4 has 1 cp state, epoch 3 has 2 checkpoint states
        numStatesPersisted: 6,
        numEpochsInMemory: 0,
        // epoch 0 1 2 3 4
        numEpochsPersisted: 5,
        // chain is not finalized end of test
      },
      /**
       * Block slot 28 has parent slot 25, block slot 26 and 27 are reorged
       *                        --------------------|---
       *                       /       ^  ^         ^  ^
       *                      /       28  29        32 33
       * |----------------|----------
       *                  ^  ^  ^  ^
       *                 24 25 26  27
       * */
      {
        name: "maxCPStateEpochsInMemory=1, reorg in same epoch",
        reorgedSlot: 27,
        reorgDistance: 3,
        maxBlockStates: 1,
        maxCPStateEpochsInMemory: 1,
        // no need to reload as cp state epoch 3 is available in memory
        reloadCount: 0,
        // 1 time for epoch 0 1 2 3, cp state epoch 4 is in memory
        persistCount: 4,
        // epoch 4, one for Current Root Checkpoint State and one for Previous Root Checkpoint State
        numStatesInMemory: 2,
        // epoch 2 3, epoch 4 is in-memory
        numStatesPersisted: 2,
        // epoch 3
        numEpochsInMemory: 1,
        // epoch 2 3, epoch 4 is in-memory
        numEpochsPersisted: 2,
        // chain is finalized at epoch 2 end of test
      },
      /**
       * Block slot 28 has parent slot 23, block slot 824 25 26 and 27 are reorged
       *                                   --------------------------|---
       *                                 / |            ^  ^         ^  ^
       *                                /  |           28  29       32  33
       *                  |----------------|----------
       *                 16             ^  ^  ^  ^  ^
       *                               23 24 25 26  27
       *                                   ^
       *                               PRCS at epoch 3 is persisted, CRCS is pruned
       */
      {
        name: "maxCPStateEpochsInMemory=1, reorg last slot of previous epoch",
        reorgedSlot: 27,
        reorgDistance: 5,
        maxBlockStates: 1,
        maxCPStateEpochsInMemory: 1,
        // PRCS at epoch 3 is available in memory so no need to reload
        reloadCount: 0,
        // 1 cp state for epoch 0 1 2 3
        persistCount: 4,
        // epoch 4, one for Current Root Checkpoint State and one for Previous Root Checkpoint State
        numStatesInMemory: 2,
        // chain is not finalized, epoch 4 is in-memory so CP state at epoch 0 1 2 3 are persisted
        numStatesPersisted: 4,
        // epoch 4
        numEpochsInMemory: 1,
        // chain is not finalized, epoch 4 is in-memory so CP state at epoch 0 1 2 3 are persisted
        numEpochsPersisted: 4,
        // chain is NOT finalized end of test
      },
      /**
       * Block slot 28 has parent slot 23, block slot 824 25 26 and 27 are reorged
       *                             --------------------------------|---
       *                            /      |            ^  ^         ^  ^
       *                           /       |           28  29       32  33
       *                  |----------------|----------
       *                 16        ^    ^  ^  ^  ^  ^
       *                          19   23 24 25 26  27
       *                                   ^
       *                               PRCS at epoch 3 is persisted, CRCS is pruned
       */
      {
        name: "maxCPStateEpochsInMemory=1, reorg middle slot of previous epoch",
        reorgedSlot: 27,
        reorgDistance: 9,
        maxBlockStates: 1,
        maxCPStateEpochsInMemory: 1,
        // reload CP state epoch 2 (slot = 16)
        reloadCount: 1,
        // 1 cp state for epoch 0 1 2 3
        persistCount: 4,
        // epoch 4, one for Current Root Checkpoint State and one for Previous Root Checkpoint State
        numStatesInMemory: 2,
        // chain is not finalized, epoch 4 is in-memory so CP state at epoch 0 1 2 3 are persisted
        numStatesPersisted: 4,
        // epoch 4
        numEpochsInMemory: 1,
        // chain is not finalized, epoch 4 is in-memory so CP state at epoch 0 1 2 3 are persisted
        numEpochsPersisted: 4,
        // chain is NOT finalized end of test
      },
      /**
       * Block slot 28 has parent slot 23, block slot 824 25 26 and 27 are reorged
       *                 --------------------------------------------|---
       *                /                  |            ^  ^         ^  ^
       *               /                   |           28  29       32  33
       * |----------------|----------------|----------
       * ^            ^  16        ^    ^  ^  ^  ^  ^
       * 8           15           19   23 24 25 26  27
       *reload                             ^
       *                               PRCS at epoch 3 is persisted, CRCS is pruned
       */
      {
        name: "maxCPStateEpochsInMemory=1, reorg 2 epochs",
        reorgedSlot: 27,
        reorgDistance: 13,
        maxBlockStates: 1,
        maxCPStateEpochsInMemory: 1,
        // reload CP state epoch 2 (slot = 16)
        reloadCount: 1,
        // 1 cp state for epoch 0 1, 2 CP states for epoch 2, 1 cp state for epoch 3
        persistCount: 5,
        // epoch 4, one for Current Root Checkpoint State and one for Previous Root Checkpoint State
        numStatesInMemory: 2,
        // chain is not finalized, epoch 4 is in-memory so CP state at epoch 0 1 2 3 are persisted, epoch 2 has 2 CP states
        numStatesPersisted: 5,
        // epoch 4
        numEpochsInMemory: 1,
        // chain is not finalized, epoch 4 is in-memory so CP state at epoch 0 1 2 3 are persisted
        numEpochsPersisted: 4,
        // chain is NOT finalized end of test
      },
    ];

    for (const {
      name,
      reorgedSlot,
      reorgDistance,
      maxBlockStates,
      maxCPStateEpochsInMemory,
      reloadCount,
      persistCount,
      numStatesInMemory,
      numStatesPersisted,
      numEpochsInMemory,
      numEpochsPersisted,
    } of testCases) {
      it(`${name} reorgedSlot=${reorgedSlot} reorgDistance=${reorgDistance}`, async function () {
        // the node needs time to transpile/initialize bls worker threads
        const genesisSlotsDelay = 7;
        const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;
        const testLoggerOpts: TestLoggerOpts = {
          level: LogLevel.debug,
          timestampFormat: {
            format: TimestampFormatCode.EpochSlot,
            genesisTime,
            slotsPerEpoch: SLOTS_PER_EPOCH,
            secondsPerSlot: testParams.SECONDS_PER_SLOT,
          },
        };

        const loggerNodeA = testLogger("Reorg-Node-A", testLoggerOpts);
        const loggerNodeB = testLogger("FollowUp-Node-B", {...testLoggerOpts, level: LogLevel.debug});

        const reorgedBn = await getDevBeaconNode({
          params: testParams,
          options: {
            sync: {isSingleNode: true},
            network: {allowPublishToZeroPeers: true},
            // run the first bn with ReorgedForkChoice, no nHistoricalStates flag so it does not have to reload
            chain: {
              blsVerifyAllMainThread: true,
              forkchoiceConstructor: ReorgedForkChoice,
              proposerBoostEnabled: true,
            },
          },
          validatorCount,
          logger: loggerNodeA,
        });

        // stop bn after validators
        afterEachCallbacks.push(() => reorgedBn.close());

        const {validators} = await getAndInitDevValidators({
          node: reorgedBn,
          logPrefix: "bn-a",
          validatorsPerClient: validatorCount,
          validatorClientCount: 1,
          startIndex: 0,
          useRestApi: false,
          testLoggerOpts,
        });

        afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close())));

        const followupBn = await getDevBeaconNode({
          params: testParams,
          options: {
            api: {rest: {enabled: false}},
            // run the 2nd bn with nHistoricalStates flag and the configured maxBlockStates, maxCPStateEpochsInMemory
            chain: {
              blsVerifyAllMainThread: true,
              forkchoiceConstructor: ReorgedForkChoice,
              nHistoricalStates: true,
              maxBlockStates,
              maxCPStateEpochsInMemory,
              proposerBoostEnabled: true,
            },
            metrics: {enabled: true},
          },
          validatorCount,
          genesisTime: reorgedBn.chain.getHeadState().genesisTime,
          logger: loggerNodeB,
        });

        afterEachCallbacks.push(() => followupBn.close());

        await connect(followupBn.network, reorgedBn.network);

        // wait for checkpoint 3 at slot 24, both nodes should reach same checkpoint
        const checkpoints = await Promise.all(
          [reorgedBn, followupBn].map((bn) =>
            waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.checkpoint, 240000, (cp) => cp.epoch === 3)
          )
        );
        expect(checkpoints[0]).toEqual(checkpoints[1]);
        expect(checkpoints[0].epoch).toEqual(3);
        const head = reorgedBn.chain.forkChoice.getHead();
        loggerNodeA.info("Node A emitted checkpoint event, head slot: " + head.slot);

        // setup reorg data for both bns
        for (const bn of [reorgedBn, followupBn]) {
          (bn.chain.forkChoice as ReorgedForkChoice).reorgedSlot = reorgedSlot;
          (bn.chain.forkChoice as ReorgedForkChoice).reorgDistance = reorgDistance;
        }

        // both nodes see the reorg event
        const reorgDatas = await Promise.all(
          [reorgedBn, followupBn].map((bn) =>
            waitForEvent<ReorgEventData>(
              bn.chain.emitter,
              routes.events.EventType.chainReorg,
              240000,
              (reorgData) => reorgData.slot === reorgedSlot + 1
            )
          )
        );
        for (const reorgData of reorgDatas) {
          expect(reorgData.slot).toEqual(reorgedSlot + 1);
          expect(reorgData.depth).toEqual(reorgDistance);
        }

        // make sure both nodes can reach another checkpoint
        const checkpoints2 = await Promise.all(
          [reorgedBn, followupBn].map((bn) =>
            waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.checkpoint, 240000, (cp) => cp.epoch === 4)
          )
        );
        expect(checkpoints2[0]).toEqual(checkpoints2[1]);
        expect(checkpoints2[0].epoch).toEqual(4);

        // wait for 1 more slot to persist states
        await waitForEvent<{slot: Slot}>(
          reorgedBn.chain.emitter,
          routes.events.EventType.block,
          240000,
          ({slot}) => slot === LAST_SLOT
        );

        const reloadMetricValues = await (followupBn.metrics?.cpStateCache.stateReloadDuration as Histogram).get();
        expect(
          reloadMetricValues?.values.find(
            (value) => value.metricName === "lodestar_cp_state_cache_state_reload_seconds_count"
          )?.value
        ).toEqual(reloadCount);

        const persistMetricValues = await (followupBn.metrics?.cpStateCache.statePersistDuration as Histogram).get();
        expect(
          persistMetricValues?.values.find(
            (value) => value.metricName === "lodestar_cp_state_cache_state_persist_seconds_count"
          )?.value
        ).toEqual(persistCount);

        // assert number of persisted/in-memory states
        const stateSizeMetricValues = await (followupBn.metrics?.cpStateCache.size as unknown as Gauge).get();
        const numStateInMemoryItem = stateSizeMetricValues?.values.find(
          (value) => value.labels.type === CacheItemType.inMemory
        );
        const numStatePersistedItem = stateSizeMetricValues?.values.find(
          (value) => value.labels.type === CacheItemType.persisted
        );
        expect(numStateInMemoryItem?.value).toEqual(numStatesInMemory);
        expect(numStatePersistedItem?.value).toEqual(numStatesPersisted);

        // assert number of epochs persisted/in-memory
        const epochSizeMetricValues = await (followupBn.metrics?.cpStateCache.epochSize as unknown as Gauge).get();
        const numEpochsInMemoryItem = epochSizeMetricValues?.values.find(
          (value) => value.labels.type === CacheItemType.inMemory
        );
        const numEpochsPersistedItem = epochSizeMetricValues?.values.find(
          (value) => value.labels.type === CacheItemType.persisted
        );
        expect(numEpochsInMemoryItem?.value).toEqual(numEpochsInMemory);
        expect(numEpochsPersistedItem?.value).toEqual(numEpochsPersisted);
      });
    }
  },
  // on local environment, it takes around 70s for 2 checkpoints so make it 96s for CI
  {timeout: 96_000}
);
