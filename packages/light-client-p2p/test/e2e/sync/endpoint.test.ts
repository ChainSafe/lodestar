import {expect} from "chai";
import {createIBeaconConfig, IChainConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {getClient, routes} from "@lodestar/api";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {LogLevel, testLogger, TestLoggerOpts} from "../../utils/logger.js";

/* eslint-disable @typescript-eslint/naming-convention */
describe("lodestar / sync", function () {
  const SECONDS_PER_SLOT = 2;
  const ALTAIR_FORK_EPOCH = 0;
  const validatorCount = 1;
  const restPort = 9596;
  const chainConfig: IChainConfig = {...chainConfigDef, SECONDS_PER_SLOT, ALTAIR_FORK_EPOCH};
  const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
  const config = createIBeaconConfig(chainConfig, genesisValidatorsRoot);
  const testLoggerOpts: TestLoggerOpts = {logLevel: LogLevel.info};
  const loggerNodeA = testLogger("Node-A", testLoggerOpts);

  describe("/eth/v1/node/syncing", function () {
    const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
    afterEach(async () => {
      while (afterEachCallbacks.length > 0) {
        const callback = afterEachCallbacks.pop();
        if (callback) await callback();
      }
    });

    it("getSyncingStatus", async function () {
      this.timeout("10 min");
      const bn = await getDevBeaconNode({
        params: testParams,
        options: {
          sync: {isSingleNode: true},
          api: {rest: {enabled: true, port: restPort}},
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: loggerNodeA,
      });

      afterEachCallbacks.push(() => bn.close());

      const client = getClient({baseUrl: "http://127.0.0.1:9596"}, {config}).node;

      const expectedSyncStatus: routes.node.SyncingStatus = {
        headSlot: "0",
        syncDistance: "0",
        isSyncing: false,
        isOptimistic: false,
      };

      // expect headSlot and syncDistance to be string
      await expect(client.getSyncingStatus()).to.eventually.be.deep.equal({data: expectedSyncStatus});
    });
  });
});
