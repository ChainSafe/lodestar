import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Validator} from "@lodestar/validator";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

describe("sync / range sync through 0-block epochs for gloas", () => {
  // Blocks until slot 13, then EMPTY_EPOCHS epochs with no blocks from FIRST_EMPTY_EPOCH, then blocks again,
  // and a late node range syncs through the gap. More than MAX_LOOK_AHEAD_EPOCHS (2) also covers the look-ahead window
  const EMPTY_EPOCHS = 1;
  const FIRST_EMPTY_EPOCH = 2;
  const LAST_SLOT_BEFORE_GAP = (FIRST_EMPTY_EPOCH - 1) * SLOTS_PER_EPOCH + 5;
  const FIRST_SLOT_AFTER_GAP = (FIRST_EMPTY_EPOCH + EMPTY_EPOCHS) * SLOTS_PER_EPOCH;

  const validatorCount = 8;
  const SLOT_DURATION_MS = 2000;
  // ~58s with 1 empty epoch, each extra empty epoch adds one epoch of wall time
  vi.setConfig({testTimeout: 90_000 + EMPTY_EPOCHS * SLOTS_PER_EPOCH * SLOT_DURATION_MS});
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    // block production fails at a gloas genesis of the dev node (parent execution requests root mismatch)
    GLOAS_FORK_EPOCH: 1,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    // Cleanups run in reverse registration order, validators stop before the beacon node they depend on
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it(`should range sync a late node through ${EMPTY_EPOCHS} epoch(s) with no blocks`, async () => {
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

    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        // after the gap the head is more than an epoch behind the clock, the default tolerance would make the node
        // consider itself syncing and refuse validator duties, so no block would follow the gap
        sync: {isSingleNode: true, slotImportTolerance: (EMPTY_EPOCHS + 2) * SLOTS_PER_EPOCH},
        network: {allowPublishToZeroPeers: true, useWorker: false},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    let validators: Validator[] = [];
    const startValidators = async (): Promise<void> => {
      ({validators} = await getAndInitDevValidators({
        node: bn,
        logPrefix: "EmptyEpochSyncVc",
        validatorsPerClient: validatorCount,
        validatorClientCount: 1,
        startIndex: 0,
        useRestApi: false,
        testLoggerOpts,
      }));
    };
    const stopValidators = async (): Promise<void> => {
      const running = validators;
      validators = [];
      await Promise.all(running.map((validator) => validator.close()));
    };
    afterEachCallbacks.push(() => stopValidators());

    await startValidators();
    await waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn.chain.emitter,
      routes.events.EventType.head,
      60_000,
      ({slot}) => slot >= LAST_SLOT_BEFORE_GAP
    );
    // no proposer from here until the validators are back, so the empty epochs have no blocks
    await stopValidators();
    loggerNodeA.info("Validators stopped", {headSlot: bn.chain.forkChoice.getHead().slot});

    await bn.chain.clock.waitForSlot(FIRST_SLOT_AFTER_GAP);
    const lastBlockBeforeGap = bn.chain.forkChoice.getHead();
    await startValidators();
    const firstBlockAfterGap = await waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
      bn.chain.emitter,
      routes.events.EventType.head,
      30_000,
      ({slot}) => slot >= FIRST_SLOT_AFTER_GAP
    );
    const firstBlockAfterGapSummary = bn.chain.forkChoice.getBlockHexDefaultStatus(firstBlockAfterGap.block);
    loggerNodeA.info("First block after the gap", {slot: firstBlockAfterGap.slot, root: firstBlockAfterGap.block});

    // the gap is real: the first block after it builds directly on the last block before FIRST_EMPTY_EPOCH
    expect(lastBlockBeforeGap.slot).toBeLessThan(FIRST_EMPTY_EPOCH * SLOTS_PER_EPOCH);
    expect(firstBlockAfterGapSummary?.parentRoot).toBe(lastBlockBeforeGap.blockRoot);

    // the late node is far behind the clock, so it does not subscribe to gossip and must range sync through the gap
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

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeB.info("Node B connected to Node A");

    await vi.waitFor(
      () => {
        if (!bn2.chain.forkChoice.hasBlockHex(firstBlockAfterGap.block))
          throw Error("Node B has not imported the first block after the gap yet");
      },
      {timeout: 40_000, interval: 500}
    );
    expect(bn2.chain.forkChoice.getBlockHexDefaultStatus(firstBlockAfterGap.block)?.parentRoot).toBe(
      lastBlockBeforeGap.blockRoot
    );
    loggerNodeB.info("Node B synced through the 0-block epochs", {
      emptyEpochs: EMPTY_EPOCHS,
      slot: firstBlockAfterGap.slot,
    });
  });
});
