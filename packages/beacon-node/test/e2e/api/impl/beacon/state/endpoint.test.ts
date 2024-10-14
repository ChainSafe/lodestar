import {describe, beforeAll, afterAll, it, expect} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {ApiClient, getClient} from "@lodestar/api";
import {computeCommitteeCount} from "@lodestar/state-transition";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";

describe("beacon state api", () => {
  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 512;
  const committeesPerSlot = computeCommitteeCount(validatorCount);
  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;
  const validatorsPerCommittee = validatorCount / committeeCount;

  let bn: BeaconNode;
  let client: ApiClient["beacon"];

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

  describe("getEpochCommittees", () => {
    it("should return all committees for the given state", async () => {
      const res = await client.getEpochCommittees({stateId: "head"});
      const epochCommittees = res.value();
      const {executionOptimistic, finalized} = res.meta();

      expect(epochCommittees).toHaveLength(committeeCount);
      expect(executionOptimistic).toBe(false);
      expect(finalized).toBe(false);

      const slotCount: Record<string, number> = {};
      const indexCount: Record<string, number> = {};

      for (const committee of epochCommittees) {
        expect(committee).toBeValidEpochCommittee({
          committeeCount,
          validatorsPerCommittee,
          slotsPerEpoch: SLOTS_PER_EPOCH,
        });
        slotCount[committee.slot] = (slotCount[committee.slot] || 0) + 1;
        indexCount[committee.index] = (indexCount[committee.index] || 0) + 1;
      }

      for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
        expect(slotCount[i]).toBeWithMessage(committeesPerSlot, `Incorrect number of committees with slot ${i}`);
      }

      for (let i = 0; i < committeesPerSlot; i++) {
        expect(indexCount[i]).toBeWithMessage(SLOTS_PER_EPOCH, `Incorrect number of committees with index ${i}`);
      }
    });

    it("should restrict returned committees to those matching the supplied index", async () => {
      const index = committeesPerSlot / 2;
      const epochCommittees = (await client.getEpochCommittees({stateId: "head", index})).value();
      expect(epochCommittees).toHaveLength(SLOTS_PER_EPOCH);
      for (const committee of epochCommittees) {
        expect(committee.index).toBeWithMessage(index, "Committee index does not match supplied index");
      }
    });

    it("should restrict returned committees to those matching the supplied slot", async () => {
      const slot = SLOTS_PER_EPOCH / 2;
      const epochCommittees = (await client.getEpochCommittees({stateId: "head", slot})).value();
      expect(epochCommittees).toHaveLength(committeesPerSlot);
      for (const committee of epochCommittees) {
        expect(committee.slot).toBeWithMessage(slot, "Committee slot does not match supplied slot");
      }
    });
  });
});
