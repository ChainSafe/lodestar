import {afterEach, describe, it, vi} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ChainConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ChainEvent} from "../../../src/chain/emitter.js";
import {RegenCaller} from "../../../src/chain/regen/interface.js";
import {BackfillSyncEvent} from "../../../src/sync/backfill/backfillV2.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {LogLevel, TestLoggerOpts, testLogger} from "../../utils/logger.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

/**
 * Tests backfill sync by:
 * 1. Running Node-A with validators until finalization
 * 2. Starting Node-B from Node-A's finalized checkpoint state (simulating checkpoint sync)
 * 3. Verifying Node-B backfills historical blocks from Node-A
 */
describe("sync / backfill sync", () => {
  vi.setConfig({testTimeout: 600_000});

  const SECOND_NODE_START_EPOCH = 5;
  const SLOT_DURATION_MS = 2000;
  const validatorCount = 8;
  const MIN_EPOCHS_FOR_BLOCK_REQUESTS = 50;
  const backfillBatchSize = 8;
  const forceCheckpointSync = false;
  const NODE_A_FINALIZATION_TIMEOUT = 300_000;

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
  const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);

  const testLoggerOpts: TestLoggerOpts = {
    level: LogLevel.info,
    timestampFormat: {
      format: TimestampFormatCode.EpochSlot,
      genesisTime,
      secondsPerSlot: SLOT_DURATION_MS / 1000,
      slotsPerEpoch: SLOTS_PER_EPOCH, // default(minimal):8
    },
  };

  const validatorLoggerOpts: TestLoggerOpts = {
    level: LogLevel.warn,
    timestampFormat: testLoggerOpts.timestampFormat,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      // Small delay to let pending operations complete before shutting node
      await new Promise((r) => setTimeout(r, 500));
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("should backfill from checkpoint state", async () => {
    const loggerNodeA = testLogger("Backfill-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("Backfill-Node-B", testLoggerOpts);

    // Node-A: block producer with validators
    const bnA = await getDevBeaconNode({
      params: testParams,
      options: nodeAOptions,
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });

    const {validators} = await getAndInitDevValidators({
      node: bnA,
      logPrefix: "validator",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts: validatorLoggerOpts,
    });

    // FILO cleanup order: push nodes first (close last), validators last (close first)
    afterEachCallbacks.push(() => bnA.close().catch(() => {}));
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close().catch(() => {}))));

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
    const finalizedCp = bnA.chain.forkChoice.getFinalizedCheckpoint();

    // Todo: check again if checkpoint state creation logic is correct
    const checkpointState = await bnA.chain.regen.getCheckpointState(
      {root: fromHexString(finalizedCp.rootHex), epoch: finalizedCp.epoch},
      {dontTransferCache: true},
      RegenCaller.restApi
    );

    loggerNodeA.info("Extracted checkpoint state", {
      epoch: finalizedCp.epoch,
      root: finalizedCp.rootHex,
      stateSlot: checkpointState.slot,
    });

    // Node-B: Init backfill node from checkpoint state
    const bnB = await getDevBeaconNode({
      params: testParams,
      options: nodeBOptions,
      anchorState: checkpointState,
      wsCheckpoint: {root: fromHexString(finalizedCp.rootHex), epoch: finalizedCp.epoch},
      genesisTime,
      logger: loggerNodeB,
    });

    afterEachCallbacks.push(() => bnB.close().catch(() => {}));

    loggerNodeB.info("Node-B created from checkpoint", {
      checkpointEpoch: finalizedCp.epoch,
    });

    // connect nodes
    const connected = Promise.all([onPeerConnect(bnB.network), onPeerConnect(bnA.network)]);
    await connect(bnB.network, bnA.network);
    await connected;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const bnAPeers = bnA.network.getConnectedPeerCount();
    const bnBPeers = bnB.network.getConnectedPeerCount();
    loggerNodeA.info("Nodes connected", {bnAPeers, bnBPeers});
    if (bnBPeers === 0) {
      throw Error("Node-B failed to connect to Node-A");
    }

    // Wait for backfill sync to complete
    const backfillStartTime = Date.now();
    const maxWaitMs = 600_000;

    const initialBackfillRange = await bnB.db.backfillRange.get();
    loggerNodeB.info("BackfillRange initial state", {
      beginningEpoch: initialBackfillRange?.beginningEpoch,
      endingEpoch: initialBackfillRange?.endingEpoch,
      checkpointEpoch: finalizedCp.epoch,
    });

    // Todo: this is for debugging. remove in future
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
    }, 10_000);

    try {
      if (!bnB.backfillSync) {
        throw Error("BackfillSync is not initialized on Node-B");
      }
      // Todo: verify if this is correct event emitter usage
      // wait for BackfillSyncEvent.completed
      await waitForEvent(bnB.backfillSync.emitter, BackfillSyncEvent.completed, maxWaitMs);
      loggerNodeB.info("BackfillSyncEvent.completed received");
    } finally {
      clearInterval(progressLogger);
    }
    loggerNodeB.info("Backfill test completed successfully");
  });

  // TODO P1:
  // - should resume from existing backfillRange in DB
  // - handle skipped slots
  // - forceCheckpointSync: reinitializes range but skips refetching
  //   already-saved ranges if blocks in blockArchive are consistent

  // TODO P2:
  // - handle invalid blocks: throw error and penalise peer
  // - sync from multiple peers: as in the real case
  // - handle init with wrong wsCheckpoint
  // - handle sync with high/low peers
  // - handle slow peer responses
});
