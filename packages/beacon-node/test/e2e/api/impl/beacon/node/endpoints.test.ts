import {expect} from "chai";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {Api, getClient} from "@lodestar/api/beacon";
import {ApiError} from "@lodestar/api";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";

describe("beacon node api", function () {
  this.timeout("30s");

  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 512;

  let bn: BeaconNode;
  let client: Api;

  before(async () => {
    bn = await getDevBeaconNode({
      params: chainConfigDef,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true},
        api: {
          rest: {
            enabled: true,
            port: restPort,
          },
        },
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      logger: testLogger("Node-A", {level: LogLevel.info}),
    });
    client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});
  });

  after(async () => {
    await bn.close();
  });

  describe("getSyncingStatus", async () => {
    it("should return valid syncing status", async () => {
      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data).to.include.keys("headSlot", "syncDistance", "isSyncing", "isOptimistic", "elOffline");
    });

    it("should return 'elOffline' as 'true' for default dev node", async () => {
      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data.elOffline).to.eql(true);
    });

    it("should return 'elOffline' as 'false' if eth1 is enabled", async () => {
      // Close first instance
      await bn.close();
      bn = await getDevBeaconNode({
        params: chainConfigDef,
        options: {
          sync: {isSingleNode: true},
          network: {allowPublishToZeroPeers: true},
          eth1: {enabled: true},
          executionEngine: {mode: "mock"},
          api: {
            rest: {
              enabled: true,
              port: restPort,
            },
          },
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: testLogger("Node-A", {level: LogLevel.info}),
      });
      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data.elOffline).to.eql(false);
    });
  });
});
