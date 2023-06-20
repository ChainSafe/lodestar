import {expect} from "chai";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {Api, ApiError, getClient} from "@lodestar/api";
import {computeCommitteeCount} from "@lodestar/state-transition";
import {LogLevel, testLogger} from "../../../../../utils/logger.js";
import {getDevBeaconNode} from "../../../../../utils/node/beacon.js";
import {BeaconNode} from "../../../../../../src/node/nodejs.js";

describe("beacon state api", function () {
  this.timeout("30s");

  const restPort = 9596;
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));
  const validatorCount = 512;
  const committeesPerSlot = computeCommitteeCount(validatorCount);
  const committeeCount = committeesPerSlot * SLOTS_PER_EPOCH;
  const validatorsPerCommittee = validatorCount / committeeCount;

  let bn: BeaconNode;
  let client: Api["beacon"];

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
    client = getClient({baseUrl: `http://127.0.0.1:${restPort}`}, {config}).beacon;
  });

  after(async () => {
    await bn.close();
  });

  describe("getEpochCommittees", async () => {
    it("should return all committees for the given state", async () => {
      const res = await client.getEpochCommittees("head");
      ApiError.assert(res);
      const epochCommittees = res.response.data;

      expect(epochCommittees.length).to.be.equal(committeeCount, "Incorrect committee count");

      const slotCount: Record<string, number> = {};
      const indexCount: Record<string, number> = {};

      for (const committee of epochCommittees) {
        expect(committee.index).to.be.within(0, committeeCount - 1, "Committee index out of range");
        expect(committee.slot).to.be.within(0, SLOTS_PER_EPOCH - 1, "Committee slot out of range");
        expect(committee.validators.length).to.be.equal(
          validatorsPerCommittee,
          "Incorrect number of validators in committee"
        );
        slotCount[committee.slot] = (slotCount[committee.slot] || 0) + 1;
        indexCount[committee.index] = (indexCount[committee.index] || 0) + 1;
      }

      for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
        expect(slotCount[i]).to.be.equal(committeesPerSlot, `Incorrect number of committees with slot ${i}`);
      }

      for (let i = 0; i < committeesPerSlot; i++) {
        expect(indexCount[i]).to.be.equal(SLOTS_PER_EPOCH, `Incorrect number of committees with index ${i}`);
      }
    });

    it("should restrict returned committees to those matching the supplied index", async () => {
      const index = committeesPerSlot / 2;
      const res = await client.getEpochCommittees("head", {index});
      ApiError.assert(res);
      const epochCommittees = res.response.data;
      expect(epochCommittees.length).to.be.equal(SLOTS_PER_EPOCH, `Incorrect committee count for index ${index}`);
      for (const committee of epochCommittees) {
        expect(committee.index).to.equal(index, "Committee index does not match supplied index");
      }
    });

    it("should restrict returned committees to those matching the supplied slot", async () => {
      const slot = SLOTS_PER_EPOCH / 2;
      const res = await client.getEpochCommittees("head", {slot});
      ApiError.assert(res);
      const epochCommittees = res.response.data;
      expect(epochCommittees.length).to.be.equal(committeesPerSlot, `Incorrect committee count for slot ${slot}`);
      for (const committee of epochCommittees) {
        expect(committee.slot).to.equal(slot, "Committee slot does not match supplied slot");
      }
    });
  });
});
