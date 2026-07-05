import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {ChainEvent} from "../../../src/chain/index.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

// End-to-end coverage of `--sync.targetSync` over the wire. TargetSync's backward `by_head` walk,
// by-root data fill, and bottom-up import are exercised in two scenarios: a from-genesis sync that
// crosses the electra→fulu→gloas fork boundary, and a post-gloas checkpoint sync.
//
// NOTE: both scenarios sync a node strictly behind a quiescent producer, so the bottom-parent
// payload prime is driven only via the checkpoint anchor — the live `parentPayload` gossip race (a
// gloas block arriving before its parent's payload envelope) is not reproduced here. That classifier
// routing is unit-tested in test/unit/sync/target/targetSync.test.ts (parentPayload → child target)
// and the prime injection in test/unit/sync/target/forwardImport.test.ts.
describe("sync / targetSync from another BN", () => {
  vi.setConfig({testTimeout: 150_000});

  const validatorCount = 8;
  // fulu at genesis so a from-genesis sync crosses only the fulu->gloas boundary (no pre-fulu
  // blocks), exercising the fulu column data-fill path alongside the gloas envelope path.
  const GENESIS_FORK_EPOCH = 0;
  const GLOAS_FORK_EPOCH = 2;
  const SLOT_DURATION_MS = 2000;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: GENESIS_FORK_EPOCH,
    BELLATRIX_FORK_EPOCH: GENESIS_FORK_EPOCH,
    CAPELLA_FORK_EPOCH: GENESIS_FORK_EPOCH,
    DENEB_FORK_EPOCH: GENESIS_FORK_EPOCH,
    ELECTRA_FORK_EPOCH: GENESIS_FORK_EPOCH,
    FULU_FORK_EPOCH: GENESIS_FORK_EPOCH,
    GLOAS_FORK_EPOCH: GLOAS_FORK_EPOCH,
    BLOB_SCHEDULE: [
      {
        EPOCH: 0,
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

  function buildLoggerOpts(genesisTime: number): TestLoggerOpts {
    return {
      level: LogLevel.info,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: SLOT_DURATION_MS / 1000,
      },
    };
  }

  /** Spin up Node A: a single dev node that produces the canonical chain past gloas. */
  async function startProducerNode(
    genesisTime: number,
    testLoggerOpts: TestLoggerOpts,
    logger: ReturnType<typeof testLogger>
  ) {
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, useWorker: false},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
      logger,
    });
    afterEachCallbacks.push(() => bn.close());

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "TargetSyncVc",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

    return bn;
  }

  it("should sync from genesis across the fulu->gloas fork via TargetSync", async () => {
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);
    const testLoggerOpts = buildLoggerOpts(genesisTime);
    const loggerNodeA = testLogger("TargetSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("TargetSync-Node-B", testLoggerOpts);

    const bn = await startProducerNode(genesisTime, testLoggerOpts, loggerNodeA);

    // Node A produces past the gloas fork and finalizes into it.
    await Promise.all([
      waitForEvent<CheckpointWithHex>(
        bn.chain.emitter,
        ChainEvent.forkChoiceFinalized,
        150000,
        (finalized) => finalized.epoch >= GLOAS_FORK_EPOCH
      ),
      waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
        bn.chain.emitter,
        routes.events.EventType.head,
        150000,
        ({slot}) => slot >= (GLOAS_FORK_EPOCH + 2) * SLOTS_PER_EPOCH
      ),
    ]);
    loggerNodeA.info("Node A finalized into gloas");

    // Node B starts from genesis (fulu) and syncs forward to A's head with TargetSync. The gap
    // crosses the fulu→gloas boundary: fulu blocks fill their columns into the block input, gloas
    // blocks fill their payload envelope. B finalized-syncs first, then re-targets A's head.
    const eth1BlockHash = "0x4242424242424242424242424242424242424242";
    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        sync: {targetSync: true},
        network: {useWorker: false},
        chain: {blsVerifyAllMainThread: true},
        executionEngine: {mode: "mock", eth1BlockHash},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeB,
    });
    loggerNodeA.info("Node B created from genesis with targetSync enabled");
    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      100000,
      ({slot}) => slot >= headSummary.slot - 1
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeA.info("Node B connected to Node A");

    try {
      await waitForSynced;
      loggerNodeB.info("Node B synced to Node A's head via TargetSync", {slot: headSummary.slot});
    } catch (_e) {
      expect.fail("Node B failed to sync from genesis across the fulu->gloas fork with TargetSync in time");
    }

    expect(bn2.chain.forkChoice.getHead().slot).toBeGreaterThanOrEqual(headSummary.slot - 1);
  });

  it("should sync a gloas chain from a checkpoint via TargetSync", async () => {
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);
    const testLoggerOpts = buildLoggerOpts(genesisTime);
    const loggerNodeA = testLogger("TargetSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("TargetSync-Node-B", testLoggerOpts);

    const bn = await startProducerNode(genesisTime, testLoggerOpts, loggerNodeA);

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
    loggerNodeA.info("Node A finalized past gloas");

    const finalizedStateRes = bn.chain.getStateByCheckpoint(finalizedCp);
    if (!finalizedStateRes) {
      throw Error("Node A finalized checkpoint state not available");
    }
    const anchorState = (finalizedStateRes.state as BeaconStateView).cachedState;
    expect(anchorState.slot, "Anchor state should be at a post-gloas boundary slot").toEqual(EPOCH_3_BOUNDARY_SLOT);

    // Node B anchors at A's finalized gloas checkpoint and syncs forward to A's head — a pure-gloas
    // backward walk whose bottom parent (the anchor) is a gloas block whose payload B must prime.
    const eth1BlockHash = "0x4242424242424242424242424242424242424242";
    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        sync: {targetSync: true},
        network: {useWorker: false},
        chain: {blsVerifyAllMainThread: true},
        executionEngine: {mode: "mock", eth1BlockHash},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeB,
      anchorState,
    });
    loggerNodeA.info("Node B created with targetSync enabled, anchored at A's finalized checkpoint");
    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    const waitForSynced = waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      60000,
      ({slot}) => slot >= headSummary.slot - 1
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeA.info("Node B connected to Node A");

    try {
      await waitForSynced;
      loggerNodeB.info("Node B synced to Node A's head via TargetSync", {slot: headSummary.slot});
    } catch (_e) {
      expect.fail("Node B failed to sync from checkpoint with TargetSync in time");
    }

    expect(bn2.chain.forkChoice.getHead().slot).toBeGreaterThanOrEqual(headSummary.slot - 1);
  });
});
