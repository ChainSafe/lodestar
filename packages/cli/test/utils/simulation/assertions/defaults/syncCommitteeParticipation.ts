import {ForkName} from "@lodestar/params";
import {altair} from "@lodestar/types";
import {SimulationAssertion} from "../../interfaces.js";
import {avg} from "../../utils/index.js";
import {everyEpochMatcher} from "../matchers.js";

export const expectedMinSyncParticipationRate = 0.9;

export const syncCommitteeParticipation: SimulationAssertion<"syncCommitteeParticipation", number> = {
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
      const syncCommitteeParticipation: number[] = [];
      for (let slot = startSlot; slot <= endSlot; slot++) {
        // Sync committee is not available before until 2 slots for altair epoch
        if (slot === altairStartSlot || slot === altairStartSlot + 1) {
          continue;
        }

        const participation = store[node.cl.id][slot];
        syncCommitteeParticipation.push(participation);
      }
      const syncCommitteeParticipationAvg = avg(syncCommitteeParticipation);

      if (syncCommitteeParticipationAvg < expectedMinSyncParticipationRate) {
        errors.push(
          `node has low avg sync committee participation for epoch. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            syncCommitteeParticipationAvg: syncCommitteeParticipationAvg,
            expectedMinSyncParticipationRate,
          })}`
        );
      }
    }

    return errors;
  },
};
