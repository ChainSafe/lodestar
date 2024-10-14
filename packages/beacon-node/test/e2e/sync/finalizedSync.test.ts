import {describe, it, afterEach, vi} from "vitest";
import {assert} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {ChainConfig} from "@lodestar/config";
import {phase0} from "@lodestar/types";
import {TimestampFormatCode} from "@lodestar/logger";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {routes} from "@lodestar/api";
import {EventData, EventType} from "@lodestar/api/lib/beacon/routes/events.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {ChainEvent} from "../../../src/chain/index.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {testLogger, LogLevel, TestLoggerOpts} from "../../utils/logger.js";

describe("sync / finalized sync", () => {
  // chain is finalized at slot 32, plus 4 slots for genesis delay => ~72s it should sync pretty fast
  vi.setConfig({testTimeout: 90_000});

  const validatorCount = 8;
  const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 2,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("should do a finalized sync from another BN", async () => {
    // single node at beginning, use main thread to verify bls
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.info,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };

    const loggerNodeA = testLogger("FinalizedSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("FinalizedSync-Node-B", testLoggerOpts);

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
      logPrefix: "FinalizedSyncVc",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });

    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

    // stop beacon node after validators
    afterEachCallbacks.push(() => bn.close());

    await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.forkChoiceFinalized, 240000);
    loggerNodeA.info("Node A emitted finalized checkpoint event");

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
    loggerNodeA.info("Node B created");

    afterEachCallbacks.push(() => bn2.close());
    afterEachCallbacks.push(() => bn2.close());

    const headSummary = bn.chain.forkChoice.getHead();
    const head = await bn.db.block.get(fromHexString(headSummary.blockRoot));
    if (!head) throw Error("First beacon node has no head block");
    const waitForSynced = waitForEvent<EventData[EventType.head]>(
      bn2.chain.emitter,
      routes.events.EventType.head,
      100000,
      ({block}) => block === headSummary.blockRoot
    );

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);
    loggerNodeA.info("Node A connected to Node B");

    try {
      await waitForSynced;
      loggerNodeB.info("Node B synced to Node A, received head block", {slot: head.message.slot});
    } catch (_e) {
      assert.fail("Failed to sync to other node in time");
    }
  });
});
