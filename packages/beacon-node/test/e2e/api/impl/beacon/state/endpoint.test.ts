import {describe, beforeAll, afterAll, it, expect} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {Api, ApiError, getClient} from "@lodestar/api";
import {computeCommitteeCount} from "@lodestar/state-transition";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";

describe("beacon state api", function () {
  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 512;
  const committeesPerSlot = computeCommitteeCount(validatorCount);
  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;
  const validatorsPerCommittee = validatorCount / committeeCount;

  let bn: BeaconNode;
  let client: Api["beacon"];

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
      logger: testLogger("Node-A", {level: LogLevel.info}),
    });
    client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
  });

  afterAll(async () => {
    await bn.close();
  });

  describe("getEpochCommittees", async () => {
    it("should return all committees for the given state", async () => {
      const res = await client.getEpochCommittees("head");
      ApiError.assert(res);
      const epochCommittees = res.response.data;

      expect(epochCommittees.length).toBe(committeeCount);

      const slotCount: Record<string, number> = {};
      const indexCount: Record<string, number> = {};

      for (const committee of epochCommittees) {
        expect(committee.index).toBeGreaterThanOrEqual(0);
        expect(committee.index).toBeLessThanOrEqual(committeeCount - 1);
        expect(committee.slot).toBeGreaterThanOrEqual(0);
        expect(committee.slot).toBeLessThanOrEqual(SLOTS_PER_EPOCH - 1);
        expect(committee.validators.length).toBe(validatorsPerCommittee);
        slotCount[committee.slot] = (slotCount[committee.slot] || 0) + 1;
        indexCount[committee.index] = (indexCount[committee.index] || 0) + 1;
      }

      for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
        expect(slotCount[i]).toBe(committeesPerSlot);
      }

      for (let i = 0; i < committeesPerSlot; i++) {
        expect(indexCount[i]).toBe(SLOTS_PER_EPOCH);
      }
    });

    it("should restrict returned committees to those matching the supplied index", async () => {
      const index = committeesPerSlot / 2;
      const res = await client.getEpochCommittees("head", {index});
      ApiError.assert(res);
      const epochCommittees = res.response.data;
      expect(epochCommittees.length).toBe(SLOTS_PER_EPOCH);
      for (const committee of epochCommittees) {
        expect(committee.index).toBe(index);
      }
    });

    it("should restrict returned committees to those matching the supplied slot", async () => {
      const slot = SLOTS_PER_EPOCH / 2;
      const res = await client.getEpochCommittees("head", {slot});
      ApiError.assert(res);
      const epochCommittees = res.response.data;
      expect(epochCommittees.length).toBe(committeesPerSlot);
      for (const committee of epochCommittees) {
        expect(committee.slot).toBe(slot);
      }
    });
  });
});
