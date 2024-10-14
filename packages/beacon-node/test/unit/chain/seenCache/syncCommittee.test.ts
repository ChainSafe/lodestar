import {BitArray} from "@chainsafe/ssz";
import {describe, it, expect} from "vitest";
import {ssz} from "@lodestar/types";
import {SeenSyncCommitteeMessages, SeenContributionAndProof} from "../../../../src/chain/seenCache/index.js";

const NUM_SLOTS_IN_CACHE = 3;

describe("chain / seenCache / SeenSyncCommittee caches", () => {
  describe("SeenSyncCommitteeMessages", () => {
    const slot = 10;
    const subnet = 2;
    const validatorIndex = 100;
    const rootHex = "0x1234";

    it("should find a sync committee based on same slot and validator index", () => {
      const cache = new SeenSyncCommitteeMessages();

      // "Should not know before adding"
      expect(cache.get(slot, subnet, validatorIndex)).toBeNull();
      cache.add(slot, subnet, validatorIndex, rootHex);
      expect(cache.get(slot, subnet, validatorIndex)).toBe(rootHex);

      // "Should not know a diff slot"
      expect(cache.get(slot + 1, subnet, validatorIndex)).toBeNull();
      // "Should not know a diff subnet"
      expect(cache.get(slot, subnet + 1, validatorIndex)).toBeNull();
      // "Should not know a diff index"
      expect(cache.get(slot, subnet, validatorIndex + 1)).toBeNull();
    });

    it("should prune", () => {
      const cache = new SeenSyncCommitteeMessages();

      for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
        cache.add(slot + i, subnet, validatorIndex, rootHex);
      }

      expect(cache.get(slot, subnet, validatorIndex)).toBe(rootHex);
      cache.prune(99);
      // "Should not know after prune"
      expect(cache.get(slot, subnet, validatorIndex)).toBeNull();
    });
  });

  describe("SeenContributionAndProof", () => {
    const slot = 10;
    const subcommitteeIndex = 2;
    const aggregatorIndex = 100;

    it("should find a sync committee based on same slot and validator index", () => {
      const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
      contributionAndProof.aggregatorIndex = aggregatorIndex;
      contributionAndProof.contribution.slot = slot;
      contributionAndProof.contribution.subcommitteeIndex = subcommitteeIndex;

      const cache = new SeenContributionAndProof(null);

      expect(cache.isAggregatorKnown(slot, subcommitteeIndex, aggregatorIndex)).toBe(false);
      cache.add(contributionAndProof, 0);
      expect(cache.isAggregatorKnown(slot, subcommitteeIndex, aggregatorIndex)).toBe(true);

      expect(cache.isAggregatorKnown(slot + 1, subcommitteeIndex, aggregatorIndex)).toBe(false);
      expect(cache.isAggregatorKnown(slot, subcommitteeIndex + 1, aggregatorIndex)).toBe(false);
      expect(cache.isAggregatorKnown(slot, subcommitteeIndex, aggregatorIndex + 1)).toBe(false);
    });

    it("should prune", () => {
      const cache = new SeenContributionAndProof(null);
      const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
      contributionAndProof.aggregatorIndex = aggregatorIndex;
      contributionAndProof.contribution.slot = slot;
      contributionAndProof.contribution.subcommitteeIndex = subcommitteeIndex;

      for (let i = 0; i < NUM_SLOTS_IN_CACHE; i++) {
        cache.add(contributionAndProof, 0);
      }

      expect(cache.isAggregatorKnown(slot, subcommitteeIndex, aggregatorIndex)).toBe(true);
      expect(cache.participantsKnown(contributionAndProof.contribution)).toBe(true);

      cache.prune(99);

      expect(cache.isAggregatorKnown(slot, subcommitteeIndex, aggregatorIndex)).toBe(false);
      expect(cache.participantsKnown(contributionAndProof.contribution)).toBe(false);
    });

    const testCases: {
      id: string;
      seenAttestingBits: number[];
      checkAttestingBits: {bits: number[]; isKnown: boolean}[];
    }[] = [
      // Note: attestationsToAdd MUST intersect in order to not be aggregated and distort the results
      {
        id: "SeenContributionAndProof.participantsKnown - All have attested",
        seenAttestingBits: [0b11111111],
        checkAttestingBits: [
          {bits: [0b11111110], isKnown: true},
          {bits: [0b00000011], isKnown: true},
        ],
      },
      {
        id: "SeenContributionAndProof.participantsKnown - Some have attested",
        seenAttestingBits: [0b11110001], // equals to indexes [ 0, 4, 5, 6, 7 ]
        checkAttestingBits: [
          {bits: [0b11111110], isKnown: false},
          {bits: [0b00000011], isKnown: false},
          {bits: [0b11010001], isKnown: true},
        ],
      },
      {
        id: "SeenContributionAndProof.participantsKnown - Non have attested",
        seenAttestingBits: [0b00000000],
        checkAttestingBits: [
          {bits: [0b11111110], isKnown: false},
          {bits: [0b00000011], isKnown: false},
        ],
      },
    ];

    for (const {id, seenAttestingBits, checkAttestingBits} of testCases) {
      it(id, () => {
        const cache = new SeenContributionAndProof(null);
        const aggregationBits = new BitArray(new Uint8Array(seenAttestingBits), 8);
        const contributionAndProof = ssz.altair.ContributionAndProof.defaultValue();
        contributionAndProof.aggregatorIndex = aggregatorIndex;
        contributionAndProof.contribution.slot = slot;
        contributionAndProof.contribution.subcommitteeIndex = subcommitteeIndex;
        contributionAndProof.contribution.aggregationBits = aggregationBits;

        cache.add(contributionAndProof, aggregationBits.getTrueBitIndexes().length);

        for (const {bits, isKnown} of checkAttestingBits) {
          const subsetContribution = {
            ...contributionAndProof.contribution,
            aggregationBits: new BitArray(new Uint8Array(bits), 8),
          };
          expect(cache.participantsKnown(subsetContribution)).toBe(isKnown);
        }
      });
    }
  });
});
