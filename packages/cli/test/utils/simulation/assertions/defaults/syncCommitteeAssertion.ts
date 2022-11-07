import {ForkName} from "@lodestar/params";
import {altair} from "@lodestar/types";
import {SimulationAssertion} from "../../interfaces.js";
import {everyEpochMatcher} from "../matchers.js";

export const expectedMinSyncParticipationRate = 0.9;

export const syncCommitteeAssertion: SimulationAssertion<"syncCommitteeParticipation", number> = {
  id: "syncCommitteeParticipation",
  match: everyEpochMatcher,
  async capture({fork, block}) {
    if (fork === ForkName.phase0) {
      return 0;
    }

    const {syncCommitteeBits} = (block as altair.SignedBeaconBlock).message.body.syncAggregate;
    return syncCommitteeBits.getTrueBitIndexes().length / syncCommitteeBits.bitLen;
  },

  async assert({nodes, store, clock, epoch, forkConfig}) {
    const errors: string[] = [];
    const startSlot = clock.getFirstSlotOfEpoch(epoch);
    const endSlot = clock.getLastSlotOfEpoch(epoch);
    const altairStartSlot = clock.getFirstSlotOfEpoch(forkConfig.ALTAIR_FORK_EPOCH);

    if (epoch < forkConfig.ALTAIR_FORK_EPOCH) {
      return null;
    }

    for (const node of nodes) {
      for (let slot = startSlot; slot <= endSlot; slot++) {
        // Sync committee is not available before until 2 slots for altair epoch
        if (slot === altairStartSlot || slot === altairStartSlot + 1) {
          continue;
        }

        const participation = store[node.cl.id][slot];

        if (participation < expectedMinSyncParticipationRate) {
          errors.push(
            `node has low sync committee participation. ${JSON.stringify({
              id: node.cl.id,
              slot,
              epoch,
              participation,
              expectedMinSyncParticipationRate,
            })}`
          );
        }
      }
    }

    return errors;
  },
};
