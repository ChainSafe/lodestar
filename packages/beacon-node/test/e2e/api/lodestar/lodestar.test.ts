import {expect} from "chai";
import {createBeaconConfig, ChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {phase0} from "@lodestar/types";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getClient, HttpStatusCode} from "@lodestar/api";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../utils/logger.js";
import {getDevBeaconNode} from "../../../utils/node/beacon.js";
import {waitForEvent} from "../../../utils/events/resolver.js";
import {ChainEvent} from "../../../../src/chain/index.js";

describe("api / impl / validator", function () {
  describe("getLiveness endpoint", function () {
    const SECONDS_PER_SLOT = 2;
    const ALTAIR_FORK_EPOCH = 0;
    const validatorCount = 8;
    const restPort = 9596;
    const testParams: Pick<ChainConfig, "SECONDS_PER_SLOT" | "ALTAIR_FORK_EPOCH"> = {
      /* eslint-disable @typescript-eslint/naming-convention */
      SECONDS_PER_SLOT: SECONDS_PER_SLOT,
      ALTAIR_FORK_EPOCH: ALTAIR_FORK_EPOCH,
    };
    const genesisSlotsDelay = 5;
    const timeout = (SLOTS_PER_EPOCH + genesisSlotsDelay) * testParams.SECONDS_PER_SLOT * 1000;

    const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
    afterEach(async () => {
      while (afterEachCallbacks.length > 0) {
        const callback = afterEachCallbacks.pop();
        if (callback) await callback();
      }
    });

    it("Should return validator indices that are live", async function () {
      this.timeout("10 min");

      const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
      const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
      const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

      const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, api: ["lodestar"], port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });
      afterEachCallbacks.push(() => bn.close());

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

      await expect(client.validator.getLiveness([1, 2, 3, 4, 5], 0)).to.eventually.deep.equal(
        {
          response: {
            data: [
              {index: 1, epoch: 0, isLive: true},
              {index: 2, epoch: 0, isLive: true},
              {index: 3, epoch: 0, isLive: true},
              {index: 4, epoch: 0, isLive: true},
              {index: 5, epoch: 0, isLive: false},
            ],
          },
          ok: true,
          status: HttpStatusCode.OK,
        },
        "Wrong liveness data returned"
      );
    });

    it("Should return only for previous, current and next epoch", async function () {
      this.timeout("10 min");

      const chainConfig: ChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
      const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
      const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

      const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, api: ["lodestar"], port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });
      afterEachCallbacks.push(() => bn.close());

      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout); // wait for epoch 1
      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, ChainEvent.clockEpoch, timeout); // wait for epoch 2

      bn.chain.seenBlockProposers.add(bn.chain.clock.currentEpoch, 1);

      const client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});

      const currentEpoch = bn.chain.clock.currentEpoch;
      const nextEpoch = currentEpoch + 1;
      const previousEpoch = currentEpoch - 1;

      // current epoch is fine
      await expect(client.validator.getLiveness([1], currentEpoch)).to.not.be.rejected;
      // next epoch is fine
      await expect(client.validator.getLiveness([1], nextEpoch)).to.not.be.rejected;
      // previous epoch is fine
      await expect(client.validator.getLiveness([1], previousEpoch)).to.not.be.rejected;
      // more than next epoch is not fine
      const res1 = await client.validator.getLiveness([1], currentEpoch + 2);
      expect(res1.ok).to.be.false;
      expect(res1.error?.message).to.include(
        `Request epoch ${currentEpoch + 2} is more than one epoch before or after the current epoch ${currentEpoch}`
      );
      // more than previous epoch is not fine
      const res2 = await client.validator.getLiveness([1], currentEpoch - 2);
      expect(res2.ok).to.be.false;
      expect(res2.error?.message).to.include(
        `Request epoch ${currentEpoch - 2} is more than one epoch before or after the current epoch ${currentEpoch}`
      );
    });
  });
});
