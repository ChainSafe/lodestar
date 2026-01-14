import rimraf from "rimraf";
import {afterEach, describe, expect, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ChainConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {LoggerNode} from "@lodestar/logger/node";
import {GENESIS_EPOCH, SLOTS_PER_EPOCH} from "@lodestar/params";
import {CachedBeaconStateAllForks, computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {sleep} from "@lodestar/utils";
import {ChainEvent} from "../../../src/chain/emitter.js";
import {RegenCaller} from "../../../src/chain/regen/interface.js";
import {BackfillRangeWrapper} from "../../../src/db/single/backfillRange.ts";
import {BeaconNode} from "../../../src/index.ts";
import {BackfillSyncEvent} from "../../../src/sync/backfill/backfillV2.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {LogLevel, TestLoggerOpts, testLogger} from "../../utils/logger.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

describe("sync / backfill sync", () => {
  vi.setConfig({testTimeout: 600_000});

  const SECOND_NODE_START_EPOCH = 5;
  const SLOT_DURATION_MS = 1000;
  const validatorCount = 8;
  const MIN_EPOCHS_FOR_BLOCK_REQUESTS = 15;
  const backfillBatchSize = 8;
  const forceCheckpointSync = false;
  const NODE_A_FINALIZATION_TIMEOUT = 300_000;
  const BACKFILL_DB_PATH = "./temp/backfill-test-db/node-b";

  const testParams: Partial<ChainConfig> = {
    MIN_EPOCHS_FOR_BLOCK_REQUESTS,
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
  };

  const nodeAOptions = {
    sync: {isSingleNode: true},
    network: {allowPublishToZeroPeers: true},
    chain: {blsVerifyAllMainThread: true},
    api: {rest: {enabled: false}},
  };
  const nodeBOptions = {
    sync: {backfillBatchSize, forceCheckpointSync},
    chain: {blsVerifyAllMainThread: true},
    api: {rest: {enabled: false}},
  };

  // Genesis delay for initialization
  const genesisSlotsDelay = 4;
  const getGenesisTime = (): number => Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);

  const getTestLoggerOpts = (genesisTime: number): TestLoggerOpts => ({
    level: LogLevel.info,
    timestampFormat: {
      format: TimestampFormatCode.EpochSlot,
      genesisTime,
      secondsPerSlot: SLOT_DURATION_MS / 1000,
      slotsPerEpoch: SLOTS_PER_EPOCH, // default(minimal):8
    },
  });

  const getValidatorLoggerOpts = (genesisTime: number): TestLoggerOpts => ({
    level: LogLevel.warn,
    timestampFormat: getTestLoggerOpts(genesisTime).timestampFormat,
  });

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      // Small delay to let pending operations complete before shutting node
      await new Promise((r) => setTimeout(r, 500));
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const initValidatorNode = async (genesisTime: number, loggerNode: LoggerNode): Promise<BeaconNode> => {
    const bn = await getDevBeaconNode({
      params: testParams,
      options: nodeAOptions,
      validatorCount,
      genesisTime,
      logger: loggerNode,
    });

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "validator",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts: getValidatorLoggerOpts(genesisTime),
    });

    // FILO cleanup order: push nodes first (close last), validators last (close first)
    afterEachCallbacks.push(() => bn.close().catch(() => {}));
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close().catch(() => {}))));

    return bn;
  };

  const removeDbDir = async (backfillDbPath: string): Promise<void> => {
    await rimraf(backfillDbPath);
  };

  const getFinalizedCheckpoint = async (
    bn: BeaconNode
  ): Promise<{finalizedCp: CheckpointWithHex; checkpointState: CachedBeaconStateAllForks}> => {
    const finalizedCp = bn.chain.forkChoice.getFinalizedCheckpoint();

    // Todo: check again if checkpoint state creation logic is correct
    const checkpointState = await bn.chain.regen.getCheckpointState(
      {root: fromHexString(finalizedCp.rootHex), epoch: finalizedCp.epoch},
      {dontTransferCache: true},
      RegenCaller.restApi
    );
    return {finalizedCp, checkpointState};
  };

  const initBackfillNode = async (
    genesisTime: number,
    loggerNode: LoggerNode,
    finalizedCp?: CheckpointWithHex,
    checkpointState?: CachedBeaconStateAllForks,
    forceCheckpointSync?: boolean,
    dbPath?: string
  ): Promise<BeaconNode> => {
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {...nodeBOptions, sync: {...nodeBOptions.sync, forceCheckpointSync}, db: {name: dbPath}},
      anchorState: checkpointState ?? undefined,
      wsCheckpoint: finalizedCp ? {root: fromHexString(finalizedCp.rootHex), epoch: finalizedCp.epoch} : undefined,
      genesisTime,
      logger: loggerNode,
    });

    afterEachCallbacks.push(() => bn.close().catch(() => {}));

    loggerNode.info("Node-B created from checkpoint", {
      checkpointEpoch: finalizedCp?.epoch,
    });
    return bn;
  };

  const connectNodes = async (bnA: BeaconNode, bnB: BeaconNode): Promise<void> => {
    const connected = Promise.all([onPeerConnect(bnB.network), onPeerConnect(bnA.network)]);
    await connect(bnB.network, bnA.network);
    await connected;

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const bnAPeers = bnA.network.getConnectedPeerCount();
    const bnBPeers = bnB.network.getConnectedPeerCount();

    if (bnAPeers === 0 || bnBPeers === 0) {
      throw new Error("Node-B failed to connect to Node-A");
    }
  };

  it.skip("should backfill from checkpoint state on fresh startup", async () => {
    // Flow:
    // start with fresh DB
    // create proposer node A
    // create backfill node B
    // run sync loop
    // verify sync completes correctly
    const genesisTime = getGenesisTime();
    const loggerNodeA = testLogger("Backfill-Node-A", getTestLoggerOpts(genesisTime));
    const loggerNodeB = testLogger("Backfill-Node-B", getTestLoggerOpts(genesisTime));

    // Node-A: block producer with validators
    const bnA = await initValidatorNode(genesisTime, loggerNodeA);

    // wait for nodeA to reach SECOND_NODE_START_EPOCH
    loggerNodeA.info("Waiting for finalization at epoch", {targetEpoch: SECOND_NODE_START_EPOCH});
    await waitForEvent(
      bnA.chain.emitter,
      ChainEvent.forkChoiceFinalized,
      NODE_A_FINALIZATION_TIMEOUT,
      (cp: CheckpointWithHex) => cp.epoch >= SECOND_NODE_START_EPOCH
    );
    loggerNodeA.info("Node-A reached target epoch", {
      finalizedEpoch: bnA.chain.forkChoice.getFinalizedCheckpoint().epoch,
      headSlot: bnA.chain.forkChoice.getHead().slot,
    });

    // Extract checkpoint state from Node-A to initialize Node-B (simulates checkpoint sync)
    const {finalizedCp, checkpointState} = await getFinalizedCheckpoint(bnA);
    loggerNodeA.info("Extracted checkpoint state", {
      epoch: finalizedCp.epoch,
      root: finalizedCp.rootHex,
      stateSlot: checkpointState.slot,
    });

    // Node-B: Init backfill node from checkpoint state
    const bnB = await initBackfillNode(genesisTime, loggerNodeB, finalizedCp, checkpointState);

    // attach spy before connection to ensure it captures the first sync iteration
    // infer as any to allow private member access
    const fetchBlocksSpy = vi.spyOn(bnB.backfillSync! as any, "fetchBlocks");

    await connectNodes(bnA, bnB);
    loggerNodeA.info("Nodes connected");

    // Wait for backfill sync to complete
    const backfillStartTime = Date.now();
    const maxWaitMs = 600_000;

    const initialBackfillRange = await bnB.db.backfillRange.get();
    loggerNodeB.info("BackfillRange initial state", {
      beginningEpoch: initialBackfillRange?.beginningEpoch,
      endingEpoch: initialBackfillRange?.endingEpoch,
      checkpointEpoch: finalizedCp.epoch,
    });

    // Todo: this is for debugging, remove in future
    // log progress periodically
    const progressLogger = setInterval(async () => {
      const lowestSlotInBlockArchive = await bnB.db.blockArchive.firstKey();
      const highestSlotInBlockArchive = await bnB.db.blockArchive.lastKey();
      const currentBackfillRange = await bnB.db.backfillRange.get();
      loggerNodeB.info("Backfill progress", {
        lowestSlotInBlockArchive,
        highestSlotInBlockArchive,
        backfillBeginningEpoch: currentBackfillRange?.beginningEpoch,
        backfillEndingEpoch: currentBackfillRange?.endingEpoch,
        elapsedTime: Date.now() - backfillStartTime + "ms",
      });
    }, 3_000);

    try {
      if (!bnB.backfillSync) {
        throw new Error("BackfillSync is not initialized on Node-B");
      }
      // Todo: verify if this is correct event emitter usage
      // wait for BackfillSyncEvent.completed
      await waitForEvent(bnB.backfillSync.emitter, BackfillSyncEvent.completed, maxWaitMs);

      expect(fetchBlocksSpy).toHaveBeenCalled();
      const anchorSlotUsed = fetchBlocksSpy.mock.calls[0][2]; // first call, 3rd arg
      const checkpointAnchorSlot = computeStartSlotAtEpoch(finalizedCp.epoch);
      expect(anchorSlotUsed).toBeOneOf([
        checkpointAnchorSlot,
        checkpointAnchorSlot - 1, // when start slot of checkpoint sync epoch is a missed slot
      ]);

      expect(computeEpochAtSlot(bnB.backfillSync.syncAnchor.anchorSlot ?? -1 /*invalid value will err*/)).toBeOneOf([
        GENESIS_EPOCH,
        computeEpochAtSlot(bnB.chain.forkChoice.getHead().slot) - MIN_EPOCHS_FOR_BLOCK_REQUESTS,
      ]);
      loggerNodeB.info("BackfillSyncEvent.completed received");
    } finally {
      clearInterval(progressLogger);
    }
    loggerNodeB.info("Backfill test completed successfully");
  });

  it.skip("should resume from existing backfill DB state", async () => {
    // Flow:
    // reset DB
    // create proposer node A
    // create backfill node B
    // sync for sometime
    // stop but dont delete db
    // restart
    // verify sync continues from that point and completes correctly

    await removeDbDir(BACKFILL_DB_PATH);

    const genesisTime = getGenesisTime();
    const loggerNodeA = testLogger("Backfill-Node-A", getTestLoggerOpts(genesisTime));
    const loggerNodeB = testLogger("Backfill-Node-B", getTestLoggerOpts(genesisTime));

    // Node-A: block producer with validators
    const bnA = await initValidatorNode(genesisTime, loggerNodeA);

    // wait for nodeA to reach SECOND_NODE_START_EPOCH
    loggerNodeA.info("Waiting for finalization at epoch", {targetEpoch: SECOND_NODE_START_EPOCH});
    await waitForEvent(
      bnA.chain.emitter,
      ChainEvent.forkChoiceFinalized,
      NODE_A_FINALIZATION_TIMEOUT,
      (cp: CheckpointWithHex) => cp.epoch >= SECOND_NODE_START_EPOCH
    );
    loggerNodeA.info("Node-A reached target epoch", {
      finalizedEpoch: bnA.chain.forkChoice.getFinalizedCheckpoint().epoch,
      headSlot: bnA.chain.forkChoice.getHead().slot,
    });

    // Extract checkpoint state from Node-A to initialize Node-B (simulates checkpoint sync)
    const {finalizedCp, checkpointState} = await getFinalizedCheckpoint(bnA);
    loggerNodeA.info("Extracted checkpoint state", {
      epoch: finalizedCp.epoch,
      root: finalizedCp.rootHex,
      stateSlot: checkpointState.slot,
    });

    // Node-B: Init backfill node from checkpoint state
    let bnB = await initBackfillNode(genesisTime, loggerNodeB, finalizedCp, checkpointState, false, BACKFILL_DB_PATH);

    await connectNodes(bnA, bnB);
    loggerNodeA.info("Nodes connected");

    const backfillStartTime = Date.now();
    const maxWaitMs = 600_000;

    const initialBackfillRange = await bnB.db.backfillRange.get();
    loggerNodeB.info("BackfillRange initial state", {
      beginningEpoch: initialBackfillRange?.beginningEpoch,
      endingEpoch: initialBackfillRange?.endingEpoch,
      checkpointEpoch: finalizedCp.epoch,
    });

    // Todo: this is for debugging, remove in future
    // log progress periodically
    const progressLogger = setInterval(async () => {
      try {
        const lowestSlotInBlockArchive = await bnB.db.blockArchive.firstKey();
        const highestSlotInBlockArchive = await bnB.db.blockArchive.lastKey();
        const currentBackfillRange = await bnB.db.backfillRange.get();
        loggerNodeB.info("Backfill progress", {
          lowestSlotInBlockArchive,
          highestSlotInBlockArchive,
          backfillBeginningEpoch: currentBackfillRange?.beginningEpoch,
          backfillEndingEpoch: currentBackfillRange?.endingEpoch,
          elapsedTime: Date.now() - backfillStartTime + "ms",
        });
      } catch (err) {
        // Expected: DB will be closed during node restart
        if ((err as Error & {code?: string}).code !== "LEVEL_DATABASE_NOT_OPEN") {
          throw err;
        }
      }
    }, 3_000);

    let resolveBackfillCompletedPromise: (value?: unknown) => void;
    const backfillCompletedPromise = new Promise((res) => {
      resolveBackfillCompletedPromise = res;
    });

    const restartTimerId = setInterval(async () => {
      try {
        const currentBackfillRange = (await bnB.db.backfillRange.get()) as BackfillRangeWrapper;
        if (!currentBackfillRange) throw new Error("BackfillRange not found");
        if (currentBackfillRange.beginningEpoch !== currentBackfillRange.endingEpoch) {
          const closingAnchorSlot = computeStartSlotAtEpoch(currentBackfillRange.endingEpoch);

          // Pop the bnB closing callback before manually closing
          afterEachCallbacks.pop();
          await bnB.close();
          loggerNodeB.info("Closed Backfill Node B. Restarting after 1 epoch");

          // sleep for 1 epoch - (optional)
          await sleep(1 * SLOTS_PER_EPOCH * SLOT_DURATION_MS);

          bnB = await initBackfillNode(genesisTime, loggerNodeB, undefined, undefined, false, BACKFILL_DB_PATH);

          // attach spy before connection to ensure it captures the first sync iteration
          // infer as any to allow private member access
          const fetchBlocksSpy = vi.spyOn(bnB.backfillSync! as any, "fetchBlocks");

          await connectNodes(bnA, bnB);
          clearInterval(restartTimerId);

          expect(fetchBlocksSpy).toHaveBeenCalled();
          const anchorSlotUsed = fetchBlocksSpy.mock.calls[0][2]; // first call, 3rd arg
          expect(anchorSlotUsed).toBe(closingAnchorSlot);

          if (!bnB.backfillSync) throw new Error("BackfillSync is not initialized on Node-B");
          await waitForEvent(bnB.backfillSync.emitter, BackfillSyncEvent.completed, maxWaitMs);
          loggerNodeB.info("BackfillSyncEvent.completed received");

          expect(computeEpochAtSlot(bnB.backfillSync.syncAnchor.anchorSlot ?? -1 /*invalid value will err*/)).toBeOneOf(
            [GENESIS_EPOCH, computeEpochAtSlot(bnB.chain.forkChoice.getHead().slot) - MIN_EPOCHS_FOR_BLOCK_REQUESTS]
          );
          resolveBackfillCompletedPromise();
        }
      } catch (err) {
        // Expected: DB will be closed during node restart
        if ((err as Error & {code?: string}).code !== "LEVEL_DATABASE_NOT_OPEN") {
          throw err;
        }
      }
    }, 3_000);

    try {
      await backfillCompletedPromise;
    } finally {
      clearInterval(progressLogger);
      await removeDbDir(BACKFILL_DB_PATH);
    }
    loggerNodeB.info("Backfill test completed successfully");
  });

  it.skip("should handle skipped slots", async () => {
    // somehow configure validator to skip slots in between without changing source code
    // rest setup is same as first one
  });

  it("should skip already filled ranges while backfilling with forcedCheckpointSync", async () => {
    // Flow:
    // reset DB
    // create proposer node A
    // create backfill node B
    // sync for sometime
    // stop but dont delete db
    // optionally sleep for sometime
    // restart with forcedCheckpointSync flag
    // (this can be repeated many times to create more disjoint filled ranges in blockArchive)
    // verify sync loop starts, fetches and completes correctly

    const forceCheckpointSync = true;

    await removeDbDir(BACKFILL_DB_PATH);

    const genesisTime = getGenesisTime();
    const loggerNodeA = testLogger("Backfill-Node-A", getTestLoggerOpts(genesisTime));
    const loggerNodeB = testLogger("Backfill-Node-B", getTestLoggerOpts(genesisTime));

    // Node-A: block producer with validators
    const bnA = await initValidatorNode(genesisTime, loggerNodeA);

    // wait for nodeA to reach SECOND_NODE_START_EPOCH
    loggerNodeA.info("Waiting for finalization at epoch", {targetEpoch: SECOND_NODE_START_EPOCH});
    await waitForEvent(
      bnA.chain.emitter,
      ChainEvent.forkChoiceFinalized,
      NODE_A_FINALIZATION_TIMEOUT,
      (cp: CheckpointWithHex) => cp.epoch >= SECOND_NODE_START_EPOCH
    );
    loggerNodeA.info("Node-A reached target epoch", {
      finalizedEpoch: bnA.chain.forkChoice.getFinalizedCheckpoint().epoch,
      headSlot: bnA.chain.forkChoice.getHead().slot,
    });

    // Extract checkpoint state from Node-A to initialize Node-B (simulates checkpoint sync)
    const {finalizedCp, checkpointState} = await getFinalizedCheckpoint(bnA);
    loggerNodeA.info("Extracted checkpoint state", {
      epoch: finalizedCp.epoch,
      root: finalizedCp.rootHex,
      stateSlot: checkpointState.slot,
    });

    // Node-B: Init backfill node from checkpoint state
    let bnB = await initBackfillNode(genesisTime, loggerNodeB, finalizedCp, checkpointState, false, BACKFILL_DB_PATH);

    await connectNodes(bnA, bnB);
    loggerNodeA.info("Nodes connected");

    // Wait for backfill sync to complete
    const backfillStartTime = Date.now();
    const maxWaitMs = 600_000;

    const initialBackfillRange = await bnB.db.backfillRange.get();
    loggerNodeB.info("BackfillRange initial state", {
      beginningEpoch: initialBackfillRange?.beginningEpoch,
      endingEpoch: initialBackfillRange?.endingEpoch,
      checkpointEpoch: finalizedCp.epoch,
    });

    // Todo: this is for debugging, remove in future
    // log progress periodically
    const progressLogger = setInterval(async () => {
      try {
        const lowestSlotInBlockArchive = await bnB.db.blockArchive.firstKey();
        const highestSlotInBlockArchive = await bnB.db.blockArchive.lastKey();
        const currentBackfillRange = await bnB.db.backfillRange.get();
        loggerNodeB.info("Backfill progress", {
          lowestSlotInBlockArchive,
          highestSlotInBlockArchive,
          backfillBeginningEpoch: currentBackfillRange?.beginningEpoch,
          backfillEndingEpoch: currentBackfillRange?.endingEpoch,
          elapsedTime: Date.now() - backfillStartTime + "ms",
        });
        const blockArchiveKeys = await bnB.db.blockArchive.keys();
        loggerNodeB.info("Backfill node BlockArchive entries", blockArchiveKeys.toString());
      } catch (err) {
        // Expected: DB will be closed during node restart
        if ((err as Error & {code?: string}).code !== "LEVEL_DATABASE_NOT_OPEN") {
          throw err;
        }
      }
    }, 3_000);

    let resolveBackfillCompletedPromise: (value?: unknown) => void;
    let rejectBackfillCompletedPromise: (reason?: unknown) => void;
    const backfillCompletedPromise = new Promise((res, rej) => {
      resolveBackfillCompletedPromise = res;
      rejectBackfillCompletedPromise = rej;
    });

    const restartTimerId = setInterval(async () => {
      try {
        const currentBackfillRange = await bnB.db.backfillRange.get();
        if (!currentBackfillRange) throw new Error("BackfillRange not found");
        const {beginningEpoch, endingEpoch} = currentBackfillRange;
        if (beginningEpoch !== endingEpoch) {
          clearInterval(restartTimerId);
          // Pop the bnB closing callback before manually closing
          afterEachCallbacks.pop();
          await bnB.close();
          loggerNodeB.info("Closed Backfill Node B. Restarting after 1.5 epoch");

          // sleep for 1.5 epoch - (optional)
          await sleep(1.5 * SLOTS_PER_EPOCH * SLOT_DURATION_MS);

          // Extract checkpoint state from Node-A to initialize Node-B (simulates checkpoint sync)
          const {finalizedCp, checkpointState} = await getFinalizedCheckpoint(bnA);
          loggerNodeA.info("Extracted checkpoint state", {
            epoch: finalizedCp.epoch,
            root: finalizedCp.rootHex,
            stateSlot: checkpointState.slot,
          });
          bnB = await initBackfillNode(
            genesisTime,
            loggerNodeB,
            finalizedCp,
            checkpointState,
            forceCheckpointSync,
            BACKFILL_DB_PATH
          );

          // attach spy before connection to ensure it captures the first sync iteration
          // infer as any to allow private member access
          const fetchBlocksSpy = vi.spyOn(bnB.backfillSync! as any, "fetchBlocks");

          // IMPORTANT: Register event listener BEFORE connecting peers to avoid race condition.
          // The sync can complete very quickly after peers connect, so we must listen first.
          if (!bnB.backfillSync) throw new Error("BackfillSync is not initialized on Node-B");
          const backfillCompletedEvent = waitForEvent(bnB.backfillSync.emitter, BackfillSyncEvent.completed, maxWaitMs);

          await connectNodes(bnA, bnB);
          // clearInterval(restartTimerId);

          // Now wait for the event that we already started listening for
          await backfillCompletedEvent;
          loggerNodeB.info("BackfillSyncEvent.completed received");

          expect(fetchBlocksSpy).toHaveBeenCalled();
          const anchorSlotUsed = fetchBlocksSpy.mock.calls[0][2]; // first call, 3rd arg
          // this fails when it merges epochs just at restart
          expect(anchorSlotUsed).toBe(computeStartSlotAtEpoch(finalizedCp.epoch));

          // call[2] is anchorSlot, and we fetch (anchorSlot-1) and prev slots
          const epochsFetched = fetchBlocksSpy.mock.calls.map((call) => computeEpochAtSlot(Number(call[2]) - 1));
          const duplicateFetchedEpochs = epochsFetched.filter((e) => e >= endingEpoch && e <= beginningEpoch);
          expect(duplicateFetchedEpochs).toEqual([]);

          expect(computeEpochAtSlot(bnB.backfillSync.syncAnchor.anchorSlot ?? -1 /*invalid value will err*/)).toBeOneOf(
            [GENESIS_EPOCH, computeEpochAtSlot(bnB.chain.forkChoice.getHead().slot) - MIN_EPOCHS_FOR_BLOCK_REQUESTS]
          );
          resolveBackfillCompletedPromise();
        }
      } catch (err) {
        // Only suppress DB closed errors during node restart
        // All other errors (including assertion failures) must be propagated
        if ((err as Error & {code?: string}).code === "LEVEL_DATABASE_NOT_OPEN") {
          // Expected: DB will be closed during node restart, ignore
          return;
        }
        // Reject the promise with the error so the test properly fails
        loggerNodeB.error("Error in restart interval callback", {error: (err as Error).message});
        clearInterval(restartTimerId);
        rejectBackfillCompletedPromise(err);
      }
    }, 3_000);

    try {
      // we need to wait here until BackfillSyncEvent.completed received in the setInterval
      await backfillCompletedPromise;
    } finally {
      clearInterval(progressLogger);
      await removeDbDir(BACKFILL_DB_PATH);
    }
    loggerNodeB.info("Backfill test completed successfully");
  });

  // DONE:
  // - should backfill from checkpoint state on fresh startup
  // - should resume from existing backfill DB state
  // - should skip already filled ranges while backfilling with forcedCheckpointSync
  // TODO:
  // - handle db blockArchive inconsistent wrt checkpoint sync state
  // - handle skipped slots
  // - handle invalid blocks: throw error and penalise peer
  // - sync from multiple peers: as in the real case
  // - handle init with wrong wsCheckpoint
  // - handle sync with high/low peers
  // - handle slow peer responses
});
