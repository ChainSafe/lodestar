import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {CheckpointWithHex, ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {ChainEvent} from "../../../src/chain/index.js";
import {ReorgedForkChoice} from "../../mocks/fork-choice/reorg.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

describe("sync / checkpoint sync optimistic flow for gloas", () => {
  // Budget breakdown:
  //   ~93s — genesis delay + slot 0 → slot 40 (epoch 3 finalized) + setup overhead
  //    30s — Node B's `waitForSynced` timeout (line below)
  //   ~10s — buffer for cleanup and async drain
  // Total ~135s. Lower than this and vitest's outer timeout fires before `waitForSynced`
  // can reject, which masks the meaningful "Node B failed to sync" expect.fail message.
  vi.setConfig({testTimeout: 150_000});

  const validatorCount = 8;
  const ELECTRA_FORK_EPOCH = 0;
  const FULU_FORK_EPOCH = 1;
  const GLOAS_FORK_EPOCH = 2;
  const SLOT_DURATION_MS = 2000;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    BELLATRIX_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    CAPELLA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    DENEB_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    ELECTRA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH: FULU_FORK_EPOCH,
    GLOAS_FORK_EPOCH: GLOAS_FORK_EPOCH,
    BLOB_SCHEDULE: [
      {
        EPOCH: 1,
        MAX_BLOBS_PER_BLOCK: 3,
      },
    ],
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  /**
   * Asserts every gloas variant of every block on Node B's chain is in `Syncing` state and
   * returns the list of (blockRoot, slot, variant) tuples for reuse in the back-validation step.
   */
  function assertNodeBChainIsSyncing(
    bn2: Awaited<ReturnType<typeof getDevBeaconNode>>,
    loggerNodeB: ReturnType<typeof testLogger>
  ): Array<{blockRoot: string; slot: Slot; variant: PayloadStatus}> {
    // For ancestors below head: check all 3 variants (PENDING, EMPTY, FULL).
    // For the head: range sync may have delivered the block but not its envelope yet.
    const bn2Head = bn2.chain.forkChoice.getHead();
    const gloasFirstSlot = GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;
    const bn2Ancestors = bn2.chain.forkChoice.getAllAncestorBlocks(bn2Head.blockRoot, bn2Head.payloadStatus);

    const variantsToCheck: Array<{blockRoot: string; slot: Slot; variant: PayloadStatus}> = [];
    for (const ancestor of bn2Ancestors) {
      if (ancestor.slot < gloasFirstSlot) continue;
      if (ancestor.blockRoot === bn2Head.blockRoot) continue;
      for (const variant of [PayloadStatus.PENDING, PayloadStatus.EMPTY, PayloadStatus.FULL]) {
        variantsToCheck.push({blockRoot: ancestor.blockRoot, slot: ancestor.slot, variant});
      }
    }
    variantsToCheck.push(
      {blockRoot: bn2Head.blockRoot, slot: bn2Head.slot, variant: PayloadStatus.PENDING},
      {blockRoot: bn2Head.blockRoot, slot: bn2Head.slot, variant: PayloadStatus.EMPTY}
    );

    for (const {blockRoot, slot, variant} of variantsToCheck) {
      const node = bn2.chain.forkChoice.getBlockHex(blockRoot, variant);
      expect(node?.executionStatus).toBeWithMessage(
        ExecutionStatus.Syncing,
        `expected gloas variant ${variant} of slot=${slot} root=${blockRoot} to be Syncing pre-validation`
      );
    }
    loggerNodeB.info("Node B fork-choice: all gloas variants on chain are Syncing (optimistic)");

    return variantsToCheck;
  }

  /**
   * Injects Node A's known VALID payload for Node B's synced head, then asserts all the variants
   * passed in (plus the head's FULL variant created by the injection) are now `Valid`.
   */
  function injectValidAndAssertBackValidated(
    bn: Awaited<ReturnType<typeof getDevBeaconNode>>,
    bn2: Awaited<ReturnType<typeof getDevBeaconNode>>,
    variantsToCheck: Array<{blockRoot: string; slot: Slot; variant: PayloadStatus}>,
    loggerNodeB: ReturnType<typeof testLogger>
  ): void {
    const bn2Head = bn2.chain.forkChoice.getHead();
    const nodeAHeadFull = bn.chain.forkChoice.getBlockHex(bn2Head.blockRoot, PayloadStatus.FULL);
    if (nodeAHeadFull === null || nodeAHeadFull.executionPayloadBlockHash === null) {
      throw Error(`No FULL variant found on Node A for synced head root=${bn2Head.blockRoot}`);
    }
    bn2.chain.forkChoice.onExecutionPayload(
      bn2Head.blockRoot,
      nodeAHeadFull.executionPayloadBlockHash,
      nodeAHeadFull.executionPayloadNumber,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    loggerNodeB.info("Injected VALID payload for synced head to trigger back-validation");

    // The head's FULL variant is created by the onExecutionPayload call above.
    const allVariants = [
      ...variantsToCheck,
      {blockRoot: bn2Head.blockRoot, slot: bn2Head.slot, variant: PayloadStatus.FULL},
    ];
    for (const {blockRoot, slot, variant} of allVariants) {
      const node = bn2.chain.forkChoice.getBlockHex(blockRoot, variant);
      expect(node?.executionStatus).toBeWithMessage(
        ExecutionStatus.Valid,
        `expected gloas variant ${variant} of slot=${slot} root=${blockRoot} to be Valid post-validation`
      );
    }
    loggerNodeB.info("All gloas variants on chain back-validated to Valid");
  }

  it("Checkpoint sync from skipped-slot checkpoint", async () => {
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.debug,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: SLOT_DURATION_MS / 1000,
      },
    };

    const loggerNodeA = testLogger("CheckpointSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("CheckpointSync-Node-B", testLoggerOpts);

    // Node A: full beacon node syncing past gloas activation. Use ReorgedForkChoice so we
    // can force a skipped checkpoint at the gloas fork boundary (see reorg setup below).
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, useWorker: false},
        chain: {blsVerifyAllMainThread: true, forkchoiceConstructor: ReorgedForkChoice},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    // Reorg slot 24 so that block at slot 25 builds on block at slot 23 (skipping slot 24).
    // Slot 24 is the epoch-3 boundary, so the finalized checkpoint at epoch 3 resolves to
    // block 23 — a "skipped checkpoint". Node B's anchor block is then a gloas block at
    // slot 23 (epoch 2 ends at slot 23, gloas fork starts at epoch 2 = slot 16); range-sync
    // from slot 24 onward fetches the dangling parent payload envelope of block 23.
    const REORGED_SLOT = (GLOAS_FORK_EPOCH + 1) * SLOTS_PER_EPOCH; // 24
    const REORG_DISTANCE = 2; // block at slot 25 has parent at slot 23
    (bn.chain.forkChoice as ReorgedForkChoice).reorgedSlot = REORGED_SLOT;
    (bn.chain.forkChoice as ReorgedForkChoice).reorgDistance = REORG_DISTANCE;

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "CheckpointSyncVc",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

    // need to make sure head of A is at least 40, ie the local status of network is up to date
    const TARGET_FINALIZED_EPOCH = GLOAS_FORK_EPOCH + 1; // 3
    const HEAD_SLOT_AFTER_FINALIZE = (TARGET_FINALIZED_EPOCH + 2) * SLOTS_PER_EPOCH; // 40
    const [finalizedCp] = await Promise.all([
      waitForEvent<CheckpointWithHex>(
        bn.chain.emitter,
        ChainEvent.forkChoiceFinalized,
        150000,
        (finalized) => finalized.epoch === TARGET_FINALIZED_EPOCH
      ),
      waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
        bn.chain.emitter,
        routes.events.EventType.head,
        150000,
        ({slot}) => slot >= HEAD_SLOT_AFTER_FINALIZE
      ),
    ]);
    loggerNodeA.info("Node A reached the epoch-3 skipped-slot finalized checkpoint");

    // Confirm the finalized checkpoint is the skipped-slot one: root must resolve to the
    // block at slot 23 (last block before the reorged slot 24), not slot 24.
    const finalizedBlock = bn.chain.forkChoice.getFinalizedBlock();
    expect(
      finalizedBlock.slot,
      "Skipped checkpoint expected: finalized block should be at slot 23, not slot 24"
    ).toEqual(REORGED_SLOT - 1);
    loggerNodeA.info("Confirmed skipped-slot finalized checkpoint", {
      epoch: finalizedCp.epoch,
      finalizedBlockSlot: finalizedBlock.slot,
      rootHex: finalizedCp.rootHex,
    });

    const finalizedStateRes = bn.chain.getStateByCheckpoint(finalizedCp);
    if (!finalizedStateRes) {
      throw Error("Node A finalized checkpoint state not available");
    }
    const anchorState = (finalizedStateRes.state as BeaconStateView).cachedState;
    expect(anchorState.slot, "Anchor state should be at the epoch-3 boundary slot").toEqual(REORGED_SLOT);
    expect(
      anchorState.latestBlockHeader.slot,
      "Anchor's latestBlockHeader should be from block 23 (the skipped slot 24's predecessor)"
    ).toEqual(REORGED_SLOT - 1);
    loggerNodeA.info("Got Node A finalized checkpoint state for B anchor", {
      epoch: finalizedCp.epoch,
      anchorStateSlot: anchorState.slot,
      anchorLatestBlockHeaderSlot: anchorState.latestBlockHeader.slot,
    });

    // Node B: starts from Node A's finalized checkpoint state.
    // use a custom eth1BlockHash so that every newPayload call will return SYNCING
    const eth1BlockHash = "0x4242424242424242424242424242424242424242";
    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        network: {useWorker: false},
        chain: {blsVerifyAllMainThread: true},
        executionEngine: {mode: "mock", eth1BlockHash},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeB,
      anchorState,
    });
    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    // 30s is plenty: Node B has to range-sync only ~17 blocks (slot 24 → ~slot 40) over
    // localhost loopback. A successful sync completes in seconds; this timeout exists to
    // bound the failure case so we surface a meaningful expect.fail message quickly.
    const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      30000,
      // TODO: right now we have to count on UnknownBlock sync for the last slot (40), since this is to test range sync
      // we can just confirm it's a pass if range sync finish its last batch (startSlot = 32, count = 8)
      // sometimes got rate limit for the batch with (startSlot = 40, count = 1)
      // need to implement cool down period for ChainPeersBalancer to avoid this
      ({slot}) => slot >= headSummary.slot - 1
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeA.info("Node B connected to Node A");

    try {
      await waitForSynced;
      loggerNodeB.info("Node B synced to Node A's head", {slot: headSummary.slot});
    } catch (_e) {
      expect.fail("Node B failed to sync to Node A's head in time");
    }

    const variants = assertNodeBChainIsSyncing(bn2, loggerNodeB);
    injectValidAndAssertBackValidated(bn, bn2, variants, loggerNodeB);
  });

  it("Checkpoint sync from regular checkpoint (no skipped slot)", async () => {
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.debug,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: SLOT_DURATION_MS / 1000,
      },
    };

    const loggerNodeA = testLogger("CheckpointSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("CheckpointSync-Node-B", testLoggerOpts);

    // Node A: full beacon node, no reorg. Anchor block will be at the epoch-3 boundary slot.
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, useWorker: false},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "CheckpointSyncVc",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

    // need to make sure head of A is at least 40, ie the local status of network is up to date
    const TARGET_FINALIZED_EPOCH = GLOAS_FORK_EPOCH + 1; // 3
    const EPOCH_3_BOUNDARY_SLOT = TARGET_FINALIZED_EPOCH * SLOTS_PER_EPOCH; // 24
    const HEAD_SLOT_AFTER_FINALIZE = (TARGET_FINALIZED_EPOCH + 2) * SLOTS_PER_EPOCH; // 40
    const [finalizedCp] = await Promise.all([
      waitForEvent<CheckpointWithHex>(
        bn.chain.emitter,
        ChainEvent.forkChoiceFinalized,
        150000,
        (finalized) => finalized.epoch === TARGET_FINALIZED_EPOCH
      ),
      waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
        bn.chain.emitter,
        routes.events.EventType.head,
        150000,
        ({slot}) => slot >= HEAD_SLOT_AFTER_FINALIZE
      ),
    ]);
    loggerNodeA.info("Node A reached the epoch-3 finalized checkpoint");

    // Confirm the finalized checkpoint resolves to the block AT the boundary slot (regular case).
    const finalizedBlock = bn.chain.forkChoice.getFinalizedBlock();
    expect(finalizedBlock.slot, "Regular checkpoint expected: finalized block should be at the boundary slot").toEqual(
      EPOCH_3_BOUNDARY_SLOT
    );

    const finalizedStateRes = bn.chain.getStateByCheckpoint(finalizedCp);
    if (!finalizedStateRes) {
      throw Error("Node A finalized checkpoint state not available");
    }
    const anchorState = (finalizedStateRes.state as BeaconStateView).cachedState;
    expect(anchorState.slot, "Anchor state should be at the epoch-3 boundary slot").toEqual(EPOCH_3_BOUNDARY_SLOT);
    expect(
      anchorState.latestBlockHeader.slot,
      "Anchor's latestBlockHeader should be at the boundary slot (no skip)"
    ).toEqual(EPOCH_3_BOUNDARY_SLOT);

    // Node B: starts from Node A's finalized checkpoint state.
    const eth1BlockHash = "0x4242424242424242424242424242424242424242";
    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        network: {useWorker: false},
        chain: {blsVerifyAllMainThread: true},
        executionEngine: {mode: "mock", eth1BlockHash},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeB,
      anchorState,
    });
    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      30000,
      ({slot}) => slot >= headSummary.slot - 1
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeA.info("Node B connected to Node A");

    try {
      await waitForSynced;
      loggerNodeB.info("Node B synced to Node A's head", {slot: headSummary.slot});
    } catch (_e) {
      expect.fail("Node B failed to sync to Node A's head in time");
    }

    const variants = assertNodeBChainIsSyncing(bn2, loggerNodeB);
    injectValidAndAssertBackValidated(bn, bn2, variants, loggerNodeB);
  });
});
