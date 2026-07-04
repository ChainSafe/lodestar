import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

/**
 * Return the length of the longest run of consecutive empty epochs (epochs containing zero blocks)
 * on a node's canonical chain.
 */
function longestEmptyEpochRun(forkChoice: IForkChoice, head: ProtoBlock): number {
  let maxRun = 0;
  let prevEpoch = Math.floor(head.slot / SLOTS_PER_EPOCH);
  for (const block of forkChoice.getAllAncestorBlocks(head.blockRoot, head.payloadStatus)) {
    const epoch = Math.floor(block.slot / SLOTS_PER_EPOCH);
    maxRun = Math.max(maxRun, prevEpoch - epoch - 1);
    prevEpoch = epoch;
  }
  return maxRun;
}

// Regression test for https://github.com/ChainSafe/lodestar/pull/9417 (issue #8147).
//
// During periods of poor chain liveness an entire epoch can be empty: every slot is skipped, so
// a BeaconBlocksByRange request for that epoch correctly returns zero blocks. Range sync used to
// throw MISSING_BLOCKS_RESPONSE on a zero-block response, which — after MAX_BATCH_DOWNLOAD_ATTEMPTS
// — killed the SyncChain and deadlocked a node trying to sync past the empty epoch. A run of empty
// epochs longer than MAX_LOOK_AHEAD_EPOCHS (= 2) additionally stalled the look-ahead window.
//
// This test drives the real end-to-end path: Node A builds a chain with a run of >= 3 empty epochs
// (created by taking all validators offline for several epochs, i.e. simulating offline proposers),
// then Node B range-syncs from genesis and must catch up to Node A's head — crossing the gap. With
// the fix Node B reaches the head; without it Node B deadlocks at the first empty epoch.
//
// ~60 slots @ 2s/slot (minimal preset, SLOTS_PER_EPOCH = 8) ⇒ Node A is ready in ~125s, leaving
// ample room under the timeout for Node B's sync (60s budget) before the outer timeout fires.
describe("sync / empty epoch range sync", () => {
  vi.setConfig({testTimeout: 300_000});

  const validatorCount = 8;
  const SLOT_DURATION_MS = 2000;
  const ELECTRA_FORK_EPOCH = 0;
  const FULU_FORK_EPOCH = 1;
  const GLOAS_FORK_EPOCH = 2;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    BELLATRIX_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    CAPELLA_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    DENEB_FORK_EPOCH: ELECTRA_FORK_EPOCH,
    ELECTRA_FORK_EPOCH,
    FULU_FORK_EPOCH,
    GLOAS_FORK_EPOCH,
    BLOB_SCHEDULE: [{EPOCH: 1, MAX_BLOBS_PER_BLOCK: 3}],
  };

  // Empty-epoch window. Produce blocks through epoch 2 (so the electra→fulu→gloas transitions all
  // happen with blocks present), take the validators offline for the next four epochs, then resume.
  // Even if a single in-flight proposal lands right after we go offline, epochs 4–6 are guaranteed
  // fully empty (>= 3, exceeding MAX_LOOK_AHEAD_EPOCHS), exercising the whole fix.
  const STOP_SLOT = 3 * SLOTS_PER_EPOCH; // 24 — first slot with no proposer
  const RESUME_SLOT = 7 * SLOTS_PER_EPOCH; // 56 — proposers come back online
  const TARGET_HEAD_MIN_SLOT = RESUME_SLOT + Math.floor(SLOTS_PER_EPOCH / 2); // 60 — at least a full batch past the gap

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("syncs through a run of empty epochs during poor liveness", async () => {
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.info,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: SLOT_DURATION_MS / 1000,
      },
    };

    const loggerNodeA = testLogger("EmptyEpochSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("EmptyEpochSync-Node-B", testLoggerOpts);

    // Node A: the lone block producer. `isSingleNode` + `allowPublishToZeroPeers` let it build a
    // chain without any peers connected.
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        // Large slotImportTolerance so Node A keeps considering itself "synced" — and keeps
        // producing — while its head sits several epochs behind the wall clock during the offline
        // window. A lone node has no peers to range-sync from, so with the default tolerance it
        // would go Stalled once the head fell > 1 epoch behind and never resume block production.
        sync: {isSingleNode: true, slotImportTolerance: 12 * SLOTS_PER_EPOCH},
        network: {allowPublishToZeroPeers: true, useWorker: false},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    // Produce blocks through epoch 2 (covering the electra→fulu→gloas transitions).
    let validators: Awaited<ReturnType<typeof getAndInitDevValidators>>["validators"] = (
      await getAndInitDevValidators({
        node: bn,
        logPrefix: "EmptyEpochSyncVc-1",
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      })
    ).validators;
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close().catch(() => {}))));

    await bn.chain.clock.waitForSlot(STOP_SLOT);

    // Sanity-check that Node A actually built a chain before we create the gap.
    expect(
      bn.chain.forkChoice.getHead().slot,
      "Node A should have produced blocks before going offline"
    ).toBeGreaterThanOrEqual(STOP_SLOT - SLOTS_PER_EPOCH);

    // Take every validator offline. With no proposer online, every slot from here until
    // the validators come back is skipped, producing a run of empty epochs on Node A's chain.
    await Promise.all(validators.map((v) => v.close()));
    loggerNodeA.info("Validators offline — empty epochs begin", {stopSlot: STOP_SLOT});

    await bn.chain.clock.waitForSlot(RESUME_SLOT);

    // Bring validators back online (fresh clients, same keys). The chain resumes building
    // on the pre-gap head, leaving the skipped slots permanently empty.
    validators = (
      await getAndInitDevValidators({
        node: bn,
        logPrefix: "EmptyEpochSyncVc-2",
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      })
    ).validators;
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close().catch(() => {}))));
    loggerNodeA.info("Validators back online — empty epochs end", {resumeSlot: RESUME_SLOT});

    // Wait until Node A has built at least a full epoch of blocks past the gap. Range sync confirms
    // an empty (AwaitingValidation) batch only once a *later* batch imports a block, so the synced
    // chain must extend past the empty run.
    await waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn.chain.emitter,
      routes.events.EventType.head,
      120_000,
      ({slot}) => slot >= TARGET_HEAD_MIN_SLOT
    );

    // Capture Node A's head past the gap as Node B's sync target. Node A keeps producing, but this
    // block stays on its canonical chain, so Node B reaching it proves it synced across the gap.
    const headSummary = bn.chain.forkChoice.getHead();
    const headRootHex = headSummary.blockRoot;
    const emptyRunNodeA = longestEmptyEpochRun(bn.chain.forkChoice, headSummary);
    loggerNodeA.info("Node A built chain past the empty epochs", {
      headSlot: headSummary.slot,
      headRoot: headRootHex,
      longestEmptyEpochRun: emptyRunNodeA,
    });

    // Precondition: the scenario we mean to exercise must actually exist on Node A's chain.
    expect(
      emptyRunNodeA,
      `Node A chain must contain a run of >= 3 empty epochs to exercise the regression (got ${emptyRunNodeA})`
    ).toBeGreaterThanOrEqual(3);

    // Node B: starts from genesis and must reach Node A's head purely via range sync, which has to
    // traverse the empty epochs.
    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        network: {useWorker: false},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeB,
    });
    afterEachCallbacks.push(() => bn2.close());

    // Attach the listener before connecting so the head event can't be missed.
    const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      60_000,
      ({block}) => block === headRootHex
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeB.info("Node B connected to Node A");

    try {
      await waitForSynced;
    } catch (_e) {
      expect.fail(
        `Node B failed to range-sync through the empty epochs to Node A's head (slot ${headSummary.slot}). ` +
          "Before the fix this deadlocks: a zero-block response for an empty epoch threw MISSING_BLOCKS_RESPONSE, " +
          "killing the SyncChain after MAX_BATCH_DOWNLOAD_ATTEMPTS."
      );
    }
  });
});
