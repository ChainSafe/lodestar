import {describe, it, afterEach, expect, vi} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {TimestampFormatCode} from "@lodestar/logger";
import {ChainConfig} from "@lodestar/config";
import {RootHex, Slot} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {toHexString} from "@lodestar/utils";
import {LogLevel, TestLoggerOpts, testLogger} from "../../utils/logger.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {TimelinessForkChoice} from "../../mocks/fork-choice/timeliness.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {ReorgEventData} from "../../../src/chain/emitter.js";

describe("proposer boost reorg", () => {
  vi.setConfig({testTimeout: 60000});

  const validatorCount = 8;
  const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT" | "REORG_PARENT_WEIGHT_THRESHOLD" | "PROPOSER_SCORE_BOOST"> = {
    SECONDS_PER_SLOT: 2,
    // need this to make block `reorgSlot - 1` strong enough
    REORG_PARENT_WEIGHT_THRESHOLD: 80,
    // need this to make block `reorgSlot + 1` to become the head
    PROPOSER_SCORE_BOOST: 120,
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  const reorgSlot = 10;
  const proposerBoostReorg = true;
  /**
   *                reorgSlot
   *              /
   * reorgSlot - 1 ------------ reorgSlot + 1
   *
   * Note that in addition of being not timely, there are other criterion that
   * the block needs to satisfy before being re-orged out. This test assumes
   * other criterion are already satisfied
   */
  it(`should reorg a late block at slot ${reorgSlot}`, async () => {
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
    const logger = testLogger("BeaconNode", testLoggerOpts);
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, mdns: true, useWorker: false},
        chain: {
          blsVerifyAllMainThread: true,
          forkchoiceConstructor: TimelinessForkChoice,
          proposerBoost: true,
          proposerBoostReorg,
        },
      },
      validatorCount,
      genesisTime,
      logger,
    });

    (bn.chain.forkChoice as TimelinessForkChoice).lateSlot = reorgSlot;
    afterEachCallbacks.push(async () => bn.close());
    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "vc-0",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close())));

    const commonAncestor = await waitForEvent<{slot: Slot; block: RootHex}>(
      bn.chain.emitter,
      routes.events.EventType.head,
      240000,
      ({slot}) => slot === reorgSlot - 1
    );
    //               reorgSlot
    //                /
    // commonAncestor ------------ newBlock
    const commonAncestorRoot = commonAncestor.block;
    const reorgBlockEventData = await waitForEvent<{slot: Slot; block: RootHex}>(
      bn.chain.emitter,
      routes.events.EventType.head,
      240000,
      ({slot}) => slot === reorgSlot
    );
    const reorgBlockRoot = reorgBlockEventData.block;
    const [newBlockEventData, reorgEventData] = await Promise.all([
      waitForEvent<{slot: Slot; block: RootHex}>(
        bn.chain.emitter,
        routes.events.EventType.block,
        240000,
        ({slot}) => slot === reorgSlot + 1
      ),
      waitForEvent<ReorgEventData>(bn.chain.emitter, routes.events.EventType.chainReorg, 240000),
    ]);
    expect(reorgEventData.slot).toEqual(reorgSlot + 1);
    const newBlock = await bn.chain.getBlockByRoot(newBlockEventData.block);
    if (newBlock == null) {
      throw Error(`Block ${reorgSlot + 1} not found`);
    }
    expect(reorgEventData.oldHeadBlock).toEqual(reorgBlockRoot);
    expect(reorgEventData.newHeadBlock).toEqual(newBlockEventData.block);
    expect(reorgEventData.depth).toEqual(2);
    expect(toHexString(newBlock?.block.message.parentRoot)).toEqual(commonAncestorRoot);
    logger.info("New block", {
      slot: newBlock.block.message.slot,
      parentRoot: toHexString(newBlock.block.message.parentRoot),
    });
  });
});
