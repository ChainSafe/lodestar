import {expect} from "chai";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {Api, getClient} from "@lodestar/api/beacon";
import {ApiError} from "@lodestar/api";
import {sleep} from "@lodestar/utils";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";
import {getAndInitDevValidators} from "../../../../../utils/node/validator.js";

describe("beacon node api", function () {
  this.timeout("30s");

  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 8;

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

  describe("getSyncingStatus", () => {
    it("should return valid syncing status", async () => {
      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data).to.eql({
        headSlot: "0",
        syncDistance: "0",
        isSyncing: false,
        isOptimistic: false,
        elOffline: false,
      });
    });

    it("should return 'el_offline' as 'true' for default dev node", async () => {
      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data.elOffline).to.eql(false);
    });

    it("should return 'el_offline' as 'true' when EL not available", async () => {
      // Close first instance
      await bn.close();
      bn = await getDevBeaconNode({
        params: {
          ...chainConfigDef,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ALTAIR_FORK_EPOCH: 0,
          // eslint-disable-next-line @typescript-eslint/naming-convention
          BELLATRIX_FORK_EPOCH: 0,
        },
        options: {
          sync: {isSingleNode: true},
          network: {allowPublishToZeroPeers: true},
          executionEngine: {mode: "http", urls: ["http://not-available-engine:9999"]},
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

      // To make BN communicate with EL, it needs to produce some blocks and for that need validators
      const {validators} = await getAndInitDevValidators({
        node: bn,
        validatorClientCount: 1,
        validatorsPerClient: validatorCount,
        startIndex: 0,
      });

      // Give node sometime to communicate with EL
      await sleep(chainConfigDef.SECONDS_PER_SLOT * 3 * 1000);

      const res = await client.node.getSyncingStatus();
      ApiError.assert(res);

      expect(res.response.data.elOffline).to.eql(true);

      await Promise.all(validators.map((v) => v.close()));
    });
  });
});
