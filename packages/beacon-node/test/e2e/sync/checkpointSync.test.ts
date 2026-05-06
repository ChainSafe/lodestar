import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {ExecutionStatus, PayloadStatus} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView, DataAvailabilityStatus} from "@lodestar/state-transition";
import {Slot, phase0} from "@lodestar/types";
import {ChainEvent} from "../../../src/chain/index.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

describe("sync / checkpoint sync optimistic flow for gloas", () => {
  vi.setConfig({testTimeout: 120_000});

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

  it("Node B optimistically syncs gloas chain and back-validates ancestors when EL returns VALID", async () => {
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

    // Node A: full beacon node syncing past gloas activation
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

    // Wait for Node A to reach a post-gloas finalized checkpoint
    await Promise.all([
      waitForEvent<phase0.Checkpoint>(
        bn.chain.emitter,
        ChainEvent.forkChoiceFinalized,
        240000,
        (finalized) => finalized.epoch >= GLOAS_FORK_EPOCH
      ),
      waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
        bn.chain.emitter,
        routes.events.EventType.head,
        100000,
        ({slot}) => slot === 32
      ),
    ]);
    loggerNodeA.info("Node A reached post-gloas finalized checkpoint");

    // Get Node A's finalized checkpoint state to use as Node B's anchor. This is what makes
    // this a true checkpoint sync: the anchor block at the checkpoint is marked Syncing
    const finalizedCp = bn.chain.forkChoice.getFinalizedCheckpoint();
    const finalizedStateRes = bn.chain.getStateByCheckpoint(finalizedCp);
    if (!finalizedStateRes) {
      throw Error("Node A finalized checkpoint state not available");
    }
    const anchorState = (finalizedStateRes.state as BeaconStateView).cachedState;
    loggerNodeA.info("Got Node A finalized checkpoint state for B anchor", {
      epoch: finalizedCp.epoch,
      slot: anchorState.slot,
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
    const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      100000,
      ({slot}) => slot >= headSummary.slot
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeA.info("Node B connected to Node A");

    try {
      await waitForSynced;
      loggerNodeB.info("Node B synced to Node A's head", {slot: headSummary.slot});
    } catch (_e) {
      expect.fail("Node B failed to sync to Node A's head in time");
    }

    // 4. Confirm optimistic state: every gloas variant on Node B's chain should be Syncing.
    // - For ancestors below head: check all 3 variants (PENDING, EMPTY, FULL).
    // - For the head: range sync may have delivered the block but not its envelope yet
    const bn2Head = bn2.chain.forkChoice.getHead();
    const gloasFirstSlot = GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;
    const bn2Ancestors = bn2.chain.forkChoice.getAllAncestorBlocks(bn2Head.blockRoot, bn2Head.payloadStatus);

    // Build the (blockRoot, slot, variant) tuples once and reuse for both pre- and
    // post-validation assertions.
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

    const expectVariantStatus = (
      blockRoot: string,
      slot: Slot,
      variant: PayloadStatus,
      expected: ExecutionStatus,
      phase: string
    ): void => {
      const node = bn2.chain.forkChoice.getBlockHex(blockRoot, variant);
      expect(node?.executionStatus).toBeWithMessage(
        expected,
        `expected gloas variant ${variant} of slot=${slot} root=${blockRoot} to be ${expected} ${phase}`
      );
    };

    for (const {blockRoot, slot, variant} of variantsToCheck) {
      expectVariantStatus(blockRoot, slot, variant, ExecutionStatus.Syncing, "pre-validation");
    }
    loggerNodeB.info("Node B fork-choice: all gloas variants on chain are Syncing (optimistic)");

    // 5. Trigger validation using Node A's known payload for Node B's synced head.
    // This simulates EL returning VALID for the payload corresponding to the optimistic head.
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

    // 6. Confirm back-validation: same iteration, plus head's FULL (now created by the
    // onExecutionPayload call above).
    variantsToCheck.push({blockRoot: bn2Head.blockRoot, slot: bn2Head.slot, variant: PayloadStatus.FULL});
    for (const {blockRoot, slot, variant} of variantsToCheck) {
      expectVariantStatus(blockRoot, slot, variant, ExecutionStatus.Valid, "post-validation");
    }
    loggerNodeB.info("All gloas variants on chain back-validated to Valid");
  });
});
