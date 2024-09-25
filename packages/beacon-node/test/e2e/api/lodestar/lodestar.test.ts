import {describe, it, afterEach, expect, vi} from "vitest";
import {createBeaconConfig, ChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {phase0} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getClient} from "@lodestar/api";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../utils/logger.js";
import {getDevBeaconNode} from "../../../utils/node/beacon.js";
import {waitForEvent} from "../../../utils/events/resolver.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {BeaconNode} from "../../../../src/index.js";

describe("api / impl / validator", function () {
  vi.setConfig({testTimeout: 60_000});

  describe("getLiveness endpoint", function () {
    let bn: BeaconNode | undefined;
    const SECONDS_PER_SLOT = 2;
    const ALTAIR_FORK_EPOCH = 0;
    const validatorCount = 8;
    const restPort = 9596;
    const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT" | "ALTAIR_FORK_EPOCH"> = {
      SECONDS_PER_SLOT: SECONDS_PER_SLOT,
      ALTAIR_FORK_EPOCH: ALTAIR_FORK_EPOCH,
    };
    const genesisSlotsDelay = 5;
    const timeout = (SLOTS_PER_EPOCH + genesisSlotsDelay) * testParams.SECONDS_PER_SLOT * 1000;

    afterEach(async () => {
      if (bn) await bn.close();
    });

    it("Should return validator indices that are live", async function () {
      const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
      const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
      const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

      const loggerNodeA = testLogger("Node-A");

      bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, api: ["lodestar"], port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });

      // live indices at epoch of consideration, epoch 0
      bn.chain.seenBlockProposers.add(0, 1);
      bn.chain.seenBlockAttesters.add(0, 2);
      bn.chain.seenAttesters.add(0, 3);
      bn.chain.seenAggregators.add(0, 4);
      // live indices at other epochs, epoch 10
      bn.chain.seenBlockProposers.add(10, 1000);
      bn.chain.seenAttesters.add(10, 2000);
      bn.chain.seenAggregators.add(10, 3000);

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});

      const res = await client.validator.getLiveness({epoch: 0, indices: [1, 2, 3, 4, 5]});

      expect(res.value()).toEqual([
        {index: 1, isLive: true},
        {index: 2, isLive: true},
        {index: 3, isLive: true},
        {index: 4, isLive: true},
        {index: 5, isLive: false},
      ]);
    });

    it("Should return only for previous, current and next epoch", async function () {
      const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
      const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
      const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

      const testLoggerOpts: TestLoggerOpts = {level: LogLevel.info};
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, api: ["lodestar"], port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });

      await waitForEvent<phase0.Checkpoint>(bn.chain.clock, ClockEvent.epoch, timeout); // wait for epoch 1
      await waitForEvent<phase0.Checkpoint>(bn.chain.clock, ClockEvent.epoch, timeout); // wait for epoch 2

      bn.chain.seenBlockProposers.add(bn.chain.clock.currentEpoch, 1);

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});

      const currentEpoch = bn.chain.clock.currentEpoch;
      const nextEpoch = currentEpoch + 1;
      const previousEpoch = currentEpoch - 1;

      // current epoch is fine
      (await client.validator.getLiveness({epoch: currentEpoch, indices: [1]})).assertOk();
      // next epoch is fine
      (await client.validator.getLiveness({epoch: nextEpoch, indices: [1]})).assertOk();
      // previous epoch is fine
      (await client.validator.getLiveness({epoch: previousEpoch, indices: [1]})).assertOk();
      // more than next epoch is not fine
      const res1 = await client.validator.getLiveness({epoch: currentEpoch + 2, indices: [1]});
      expect(res1.ok).toBe(false);
      expect(res1.error()?.message).toEqual(
        expect.stringContaining(
          `Request epoch ${currentEpoch + 2} is more than one epoch before or after the current epoch ${currentEpoch}`
        )
      );
      // more than previous epoch is not fine
      const res2 = await client.validator.getLiveness({epoch: currentEpoch - 2, indices: [1]});
      expect(res2.ok).toBe(false);
      expect(res2.error()?.message).toEqual(
        expect.stringContaining(
          `Request epoch ${currentEpoch - 2} is more than one epoch before or after the current epoch ${currentEpoch}`
        )
      );
    });
  });
});
