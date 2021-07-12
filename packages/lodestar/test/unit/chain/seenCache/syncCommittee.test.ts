import {expect} from "chai";
import {SeenSyncCommitteeMessages, SeenContributionAndProof} from "../../../../src/chain/seenCache";

const NUM_SLOTS_IN_CACHE = 3;

describe("chain / seenCache / SeenSyncCommittee caches", function () {
  describe("SeenSyncCommitteeMessages", () => {
    const slot = 10;
    const subnet = 2;
    const validatorIndex = 100;

    it("should find a sync committee based on same slot and validator index", () => {
      const cache = new SeenSyncCommitteeMessages();

      expect(cache.isKnown(slot, subnet, validatorIndex)).to.equal(false, "Should not know before adding");
      cache.add(slot, subnet, validatorIndex);
      expect(cache.isKnown(slot, subnet, validatorIndex)).to.equal(true, "Should know before adding");

      expect(cache.isKnown(slot + 1, subnet, validatorIndex)).to.equal(false, "Should not know a diff slot");
      expect(cache.isKnown(slot, subnet + 1, validatorIndex)).to.equal(false, "Should not know a diff subnet");
      expect(cache.isKnown(slot, subnet, validatorIndex + 1)).to.equal(false, "Should not know a diff index");
    });

    it("should prune", () => {
      const cache = new SeenSyncCommitteeMessages();

      for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
        cache.add(slot, subnet, validatorIndex);
      }

      expect(cache.isKnown(slot, subnet, validatorIndex)).to.equal(true, "Should know before prune");
      cache.prune(99);
      expect(cache.isKnown(slot, subnet, validatorIndex)).to.equal(false, "Should not know after prune");
    });
  });

  describe("SeenContributionAndProof", () => {
    const slot = 10;
    const subnet = 2;
    const aggregatorIndex = 100;

    it("should find a sync committee based on same slot and validator index", () => {
      const cache = new SeenContributionAndProof();

      expect(cache.isKnown(slot, subnet, aggregatorIndex)).to.equal(false, "Should not know before adding");
      cache.add(slot, subnet, aggregatorIndex);
      expect(cache.isKnown(slot, subnet, aggregatorIndex)).to.equal(true, "Should know before adding");

      expect(cache.isKnown(slot + 1, subnet, aggregatorIndex)).to.equal(false, "Should not know a diff slot");
      expect(cache.isKnown(slot, subnet + 1, aggregatorIndex)).to.equal(false, "Should not know a diff subnet");
      expect(cache.isKnown(slot, subnet, aggregatorIndex + 1)).to.equal(false, "Should not know a diff index");
    });

    it("should prune", () => {
      const cache = new SeenContributionAndProof();

      for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
        cache.add(slot, subnet, aggregatorIndex);
      }

      expect(cache.isKnown(slot, subnet, aggregatorIndex)).to.equal(true, "Should know before prune");
      cache.prune(99);
      expect(cache.isKnown(slot, subnet, aggregatorIndex)).to.equal(false, "Should not know after prune");
    });
  });
});
