import {describe, beforeAll, afterAll, it, expect, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {routes} from "@lodestar/api";
import {ApiClient, getClient} from "@lodestar/api/beacon";
import {sleep} from "@lodestar/utils";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";
import {getAndInitDevValidators} from "../../../../../utils/node/validator.js";

describe("beacon node api", () => {
  vi.setConfig({testTimeout: 60_000});

  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 8;

  let bn: BeaconNode;
  let client: ApiClient;

  beforeAll(async () => {
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
      logger: testLogger("Node-Synced", {level: LogLevel.info}),
    });
    client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config});
  });

  afterAll(async () => {
    await bn.close();
  });

  describe("getSyncingStatus", () => {
    it("should return valid syncing status", async () => {
      const res = await client.node.getSyncingStatus();

      expect(res.value()).toEqual<routes.node.SyncingStatus>({
        headSlot: 0,
        syncDistance: 0,
        isSyncing: false,
        isOptimistic: false,
        elOffline: false,
      });
    });

    it("should return 'el_offline' as 'true' for default dev node", async () => {
      const res = await client.node.getSyncingStatus();

      expect(res.value().elOffline).toEqual(false);
    });

    it("should return 'el_offline' as 'true' when EL not available", async () => {
      const portElOffline = 9597;
      const bnElOffline = await getDevBeaconNode({
        params: {
          ...chainConfigDef,
          ALTAIR_FORK_EPOCH: 0,
          BELLATRIX_FORK_EPOCH: 0,
        },
        options: {
          sync: {isSingleNode: true},
          network: {allowPublishToZeroPeers: true},
          executionEngine: {mode: "http", urls: ["http://not-available-engine:9999"]},
          api: {
            rest: {
              enabled: true,
              port: portElOffline,
            },
          },
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount: 5,
        logger: testLogger("Node-EL-Offline", {level: LogLevel.info}),
      });
      const clientElOffline = getClient({baseUrl: `http://127.0.0.1:${portElOffline}`}, {config});
      // To make BN communicate with EL, it needs to produce some blocks and for that need validators
      const {validators} = await getAndInitDevValidators({
        logPrefix: "Offline-BN",
        node: bnElOffline,
        validatorClientCount: 1,
        validatorsPerClient: validatorCount,
        startIndex: 0,
      });

      // Give node sometime to communicate with EL
      await sleep(chainConfigDef.SECONDS_PER_SLOT * 2 * 1000);

      const res = await clientElOffline.node.getSyncingStatus();

      expect(res.value().elOffline).toEqual(true);

      await Promise.all(validators.map((v) => v.close()));
      await bnElOffline.close();
    });
  });

  describe("getHealth", () => {
    const portSyncing = 9598;

    let bnSyncing: BeaconNode;
    let clientSyncing: ApiClient;

    beforeAll(async () => {
      bnSyncing = await getDevBeaconNode({
        params: chainConfigDef,
        options: {
          // Node won't consider itself synced without peers
          sync: {isSingleNode: false},
          api: {
            rest: {
              enabled: true,
              port: portSyncing,
            },
          },
          chain: {blsVerifyAllMainThread: true},
        },
        validatorCount,
        logger: testLogger("Node-Syncing", {level: LogLevel.info}),
      });
      clientSyncing = getClient({baseUrl: `http://127.0.0.1:${portSyncing}`}, {config});
      // Must at least wait for one slot else node considers itself synced pre/at genesis
      await sleep(chainConfigDef.SECONDS_PER_SLOT * 1000);
    });

    afterAll(async () => {
      await bnSyncing.close();
    });

    it("should return 200 status code if node is ready", async () => {
      const res = await client.node.getHealth();
      expect(res.status).toBe(200);
    });

    it("should return 206 status code if node is syncing", async () => {
      const res = await clientSyncing.node.getHealth();
      expect(res.status).toBe(206);
    });

    it("should return custom status code from 'syncing_status' query parameter if node is syncing", async () => {
      const statusCode = 204;
      const res = await clientSyncing.node.getHealth({syncingStatus: statusCode});
      expect(res.status).toBe(statusCode);
    });

    it("should only use status code from 'syncing_status' query parameter if node is syncing", async () => {
      const res = await client.node.getHealth({syncingStatus: 204});
      expect(res.status).toBe(200);
    });

    it("should return 400 status code if value of 'syncing_status' query parameter is invalid", async () => {
      const res = await clientSyncing.node.getHealth({syncingStatus: 99});
      expect(res.status).toBe(400);

      const resp = await clientSyncing.node.getHealth({syncingStatus: 600});
      expect(resp.status).toBe(400);
    });
  });
});
