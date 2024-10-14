import {describe, beforeAll, afterAll, it, expect, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ApiClient, WireFormat, getClient} from "@lodestar/api";
import {
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  isBlindedSignedBeaconBlock,
  isExecutionPayload,
  isExecutionPayloadHeader,
} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";
import {getConfig} from "../../../../../utils/config.js";

describe("beacon block api", () => {
  vi.setConfig({testTimeout: 60_000, hookTimeout: 60_000});

  const restPort = 9596;
  const fork = ForkName.deneb;
  const config = createBeaconConfig(getConfig(fork), Buffer.alloc(32, 0xaa));
  const validatorCount = 8;

  let bn: BeaconNode;
  let client: ApiClient["beacon"];

  beforeAll(async () => {
    bn = await getDevBeaconNode({
      params: config,
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
    client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
  });

  afterAll(async () => {
    await bn.close();
  });

  describe("getBlockV2", () => {
    it("should return signed beacon block", async () => {
      const res = await client.getBlockV2({blockId: "head"});

      expect(res.meta().version).toBe(fork);
      expect(res.wireFormat()).toBe(WireFormat.ssz);

      const beaconBlock = res.value() as SignedBeaconBlock<typeof fork>;

      expect(isBlindedSignedBeaconBlock(beaconBlock)).toBe(false);
      expect(isExecutionPayload(beaconBlock.message.body.executionPayload)).toBe(true);
      expect(beaconBlock.message.body).not.toHaveProperty("executionPayloadHeader");
    });

    it("should return 400 if block id is invalid", async () => {
      const res = await client.getBlockV2({blockId: "current"});
      expect(res.status).toBe(400);
    });

    it("should return 404 if block not found", async () => {
      const res = await client.getBlockV2({blockId: 999});
      expect(res.status).toBe(404);
    });
  });

  describe("getBlindedBlock", () => {
    it("should return signed blinded block", async () => {
      const res = await client.getBlindedBlock({blockId: "head"});

      expect(res.meta().version).toBe(fork);
      expect(res.wireFormat()).toBe(WireFormat.ssz);

      const blindedBlock = res.value() as SignedBlindedBeaconBlock<typeof fork>;

      expect(isBlindedSignedBeaconBlock(blindedBlock)).toBe(true);
      expect(isExecutionPayloadHeader(blindedBlock.message.body.executionPayloadHeader)).toBe(true);
      expect(blindedBlock.message.body).not.toHaveProperty("executionPayload");
    });

    it("should return 400 if block id is invalid", async () => {
      const res = await client.getBlindedBlock({blockId: "current"});
      expect(res.status).toBe(400);
    });

    it("should return 404 if block not found", async () => {
      const res = await client.getBlindedBlock({blockId: 999});
      expect(res.status).toBe(404);
    });
  });
});
