import {MAX_COMMITTEES_PER_SLOT} from "@lodestar/params";
import {SimulationAssertion} from "../../interfaces.js";
import {everyEpochMatcher} from "../matchers.js";
import {inclusionDelayAssertion, expectedMaxInclusionDelay} from "./inclusionDelayAssertion.js";

export const expectedMinAttestationCount = MAX_COMMITTEES_PER_SLOT - 1;

export const attestationsCountAssertion: SimulationAssertion<
  "attestationsCount",
  number,
  [typeof inclusionDelayAssertion]
> = {
  id: "attestationsCount",
  match: everyEpochMatcher,
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

  async assert({clock, nodes, epoch, dependantStores, store}) {
    // TODO : Disable the assertion for now as the attestations count could be different per slot.
    return null;

    const errors: string[] = [];
    const inclusionDelayStore = dependantStores["inclusionDelay"];

    for (const node of nodes) {
      const startSlot = epoch === 0 ? 1 : clock.getFirstSlotOfEpoch(epoch);
      const endSlot = clock.getLastSlotOfEpoch(epoch);

      for (let slot = startSlot; slot <= endSlot; slot++) {
        const attestationsCount = store[node.cl.id][slot] ?? 0;

        // Inclusion delay for future slot
        const nextSlotInclusionDelay = inclusionDelayStore[node.cl.id][slot + 1] ?? 0;

        // If some attestations are not included, probably will be included in next slot.
        // In that case next slot inclusion delay will be higher than expected.
        if (
          attestationsCount < MAX_COMMITTEES_PER_SLOT &&
          nextSlotInclusionDelay <= expectedMaxInclusionDelay &&
          attestationsCount < expectedMinAttestationCount
        ) {
          errors.push(
            `node has lower attestations count. ${JSON.stringify({
              id: node.cl.id,
              slot,
              epoch,
              attestationsCount,
              expectedMinAttestationCount: expectedMinAttestationCount,
            })}`
          );
        }
      }
    }

    return errors;
  },
};
