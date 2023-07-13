import {expect} from "chai";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {Api, getClient, routes} from "@lodestar/api/beacon";
import {ApiError} from "@lodestar/api";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";
import {getAndInitDevValidators} from "../../../../../utils/node/validator.js";

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

  describe.only("getSyncingStatus", () => {
    it("should return valid syncing status", async () => {
      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data).to.eql({
        headSlot: "0",
        syncDistance: "0",
        isSyncing: false,
        isOptimistic: false,
        elOffline: true,
      });
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
          executionEngine: {mode: "mock"},
          api: {
            rest: {
              enabled: true,
              port: restPort,
            },
          },
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount: 5,
        logger: testLogger("Node-A", {level: LogLevel.info}),
      });
      const {validators} = await getAndInitDevValidators({
        node: bn,
        validatorClientCount: 1,
        validatorsPerClient: 5,
        startIndex: 0,
      });

      // Wait for a block to be produced, so that node can have communication with execution engine
      await new Promise((resolve) => {
        bn.chain.emitter.on(routes.events.EventType.head, async (head) => {
          if (head.slot > 2) {
            resolve(head);
          }
        });
      });

      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data.elOffline).to.eql(false);

      await Promise.all(validators.map((v) => v.close()));
    });
  });
});
