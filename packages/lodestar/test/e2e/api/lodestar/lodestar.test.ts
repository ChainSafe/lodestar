import chaiAsPromised from "chai-as-promised";
import chai, {expect} from "chai";
import {createIBeaconConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {HttpClient} from "@chainsafe/lodestar-api/src";
import {getClient} from "@chainsafe/lodestar-api/src/client/lodestar";
import {chainConfig as chainConfigDef} from "@chainsafe/lodestar-config/default";
import {LogLevel, testLogger, TestLoggerOpts} from "../../../utils/logger";
import {getDevBeaconNode} from "../../../utils/node/beacon";

chai.use(chaiAsPromised);

describe("api / impl / lodestar", function () {
  describe("getLiveness endpoint", function () {
    const SECONDS_PER_SLOT = 2;
    const ALTAIR_FORK_EPOCH = 0;
    const validatorCount = 8;
    const restPort = 9596;
    const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT" | "ALTAIR_FORK_EPOCH"> = {
      /* eslint-disable @typescript-eslint/naming-convention */
      SECONDS_PER_SLOT: SECONDS_PER_SLOT,
      ALTAIR_FORK_EPOCH: ALTAIR_FORK_EPOCH,
    };

    const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
    afterEach(async () => {
      while (afterEachCallbacks.length > 0) {
        const callback = afterEachCallbacks.pop();
        if (callback) await callback();
      }
    });

    it("Should return validator indices that are live", async function () {
      this.timeout("10 min");

      const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
      const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
      const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

      const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, api: ["lodestar"], port: restPort}},
        },
        validatorCount,
        logger: loggerNodeA,
      });
      afterEachCallbacks.push(() => bn.close());

      // live indices at epoch of consideration, epoch 0
      bn.chain.seenBlockProposers.add(1, 1);
      bn.chain.seenAttesters.add(0, 2);
      bn.chain.seenAggregators.add(0, 3);
      // live indices at other epochs
      bn.chain.seenBlockProposers.add(1000, 1000);
      bn.chain.seenAttesters.add(10, 2000);
      bn.chain.seenAggregators.add(10, 3000);

      const client = getClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${restPort}`}));

      await expect(client.getLiveness([1, 2, 3, 4], 0)).to.eventually.deep.equal(
        {
          data: [
            {index: 1, epoch: 0, isLive: true},
            {index: 2, epoch: 0, isLive: true},
            {index: 3, epoch: 0, isLive: true},
            {index: 4, epoch: 0, isLive: false},
          ],
        },
        "Wrong liveness data returned"
      );
    });

    it("Should return only for current epoch", async function () {
      // TODO [DA] Look at how to advance the epoch in test so as to confirm that
      // epoch less than previous epoch is also rejected
      this.timeout("10 min");

      const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
      const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
      const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);

      const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, api: ["lodestar"], port: restPort}},
        },
        validatorCount,
        logger: loggerNodeA,
      });
      afterEachCallbacks.push(() => bn.close());

      // live indices at epoch of consideration, epoch 0
      bn.chain.seenBlockProposers.add(1, 1);

      const client = getClient(config, new HttpClient({baseUrl: `http://127.0.0.1:${restPort}`}));

      // current epoch is fine
      await expect(client.getLiveness([1], 0)).to.eventually.not.be.rejected;
      // next epoch is fine
      await expect(client.getLiveness([1], 1)).to.eventually.not.be.rejected;
      // more than next epoch is not fine
      await expect(client.getLiveness([1], 2)).to.eventually.be.rejectedWith(
        "request epoch 2 is more than one epoch previous or after from the current epoch 0"
      );
    });
  });
});
