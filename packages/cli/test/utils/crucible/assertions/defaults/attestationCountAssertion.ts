import {MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {Match, AssertionResult, Assertion} from "../../interfaces.js";
import {inclusionDelayAssertion, expectedMaxInclusionDelay} from "./inclusionDelayAssertion.js";

export const expectedMinAttestationCount = MAX_COMMITTEES_PER_SLOT - 1;

export const attestationsCountAssertion: Assertion<"attestationsCount", number, [typeof inclusionDelayAssertion]> = {
  id: "attestationsCount",
  match: () => {
    // TODO : Disable the assertion for now as the attestations count could be different per slot.
    return Match.Capture;
  },
  dependencies: [inclusionDelayAssertion],

  async capture(input) {
    const {block} = input;
    // Use a Set since the same validator can be included in multiple attestations
    const shuffledParticipants = new Set<number>();

    for (const attestation of block.message.body.attestations) {
      // Assume constant committee size on all committees
      const committeeSize = attestation.aggregationBits.bitLen;
      const indexesInCommittee = attestation.aggregationBits.getTrueBitIndexes();
      for (const indexInCommittee of indexesInCommittee) {
        const shuffledIndex = indexInCommittee + attestation.data.index * committeeSize;
        shuffledParticipants.add(shuffledIndex);
      }
    }

    return shuffledParticipants.size;
  },

  async assert({clock, store, epoch, node, dependantStores}) {
    const errors: AssertionResult[] = [];
    const inclusionDelayStore = dependantStores.inclusionDelay;

    const startSlot = epoch === 0 ? 1 : clock.getFirstSlotOfEpoch(epoch);
    const endSlot = clock.getLastSlotOfEpoch(epoch);

    for (let slot = startSlot; slot <= endSlot; slot++) {
      const attestationsCount = store[slot] ?? 0;

      // Inclusion delay for future slot
      const nextSlotInclusionDelay = inclusionDelayStore[node.beacon.id][slot + 1] ?? 0;

      // If some attestations are not included, probably will be included in next slot.
      // In that case next slot inclusion delay will be higher than expected.
      if (
        attestationsCount < MAX_COMMITTEES_PER_SLOT &&
        nextSlotInclusionDelay <= expectedMaxInclusionDelay &&
        attestationsCount < expectedMinAttestationCount
      ) {
        errors.push([
          "node has lower attestations count",
          {
            attestationsCount,
            expectedMinAttestationCount: expectedMinAttestationCount,
          },
        ]);
      }
    }

    return errors;
  },

  async dump({store, slot, nodes}) {
    /*
     * | Slot | Node 1 | Node 2 | Node 3 |
     * |------|--------|--------|--------|
     * | 1    | 10     | 10     | 10     |
     * | 2    | 10     | 10     | 10     |
     * | 3    | 10     | 10     | 10     |
     */
    const result = [`Slot,${nodes.map((n) => n.beacon.id).join(", ")}`];
    for (let s = 1; s <= slot; s++) {
      result.push(`${s}, ${nodes.map((n) => store[n.beacon.id][s] ?? "-").join(",")}`);
    }
    return {"attestationsCountAssertion.csv": result.join("\n")};
  },
};
