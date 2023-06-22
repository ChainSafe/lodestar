import {ForkName} from "@lodestar/params";
import {altair} from "@lodestar/types";
import {AssertionMatch, AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {avg} from "../../utils/index.js";

export const expectedMinSyncParticipationRate = 0.9;

export const syncCommitteeParticipationAssertion: SimulationAssertion<"syncCommitteeParticipation", number> = {
  id: "syncCommitteeParticipation",
  match: ({slot, clock, epoch, forkConfig, fork}) => {
    if (fork === ForkName.phase0) return AssertionMatch.None;
    if (epoch < forkConfig.ALTAIR_FORK_EPOCH) return AssertionMatch.Capture;

    return clock.isLastSlotOfEpoch(slot) ? AssertionMatch.Capture | AssertionMatch.Assert : AssertionMatch.Capture;
  },

  async capture({block}) {
    const {syncCommitteeBits} = (block as altair.SignedBeaconBlock).message.body.syncAggregate;
    return syncCommitteeBits.getTrueBitIndexes().length / syncCommitteeBits.bitLen;
  },

  async assert({store, clock, epoch, forkConfig}) {
    const errors: AssertionResult[] = [];
    const startSlot = clock.getFirstSlotOfEpoch(epoch);
    const endSlot = clock.getLastSlotOfEpoch(epoch);
    const altairStartSlot = clock.getFirstSlotOfEpoch(forkConfig.ALTAIR_FORK_EPOCH);

    const syncCommitteeParticipation: number[] = [];
    for (let slot = startSlot; slot <= endSlot; slot++) {
      // Sync committee is not available before until 2 slots for altair epoch
      if (slot === altairStartSlot || slot === altairStartSlot + 1) {
        continue;
      }

      const participation = store[slot];
      syncCommitteeParticipation.push(participation);
    }
    const syncCommitteeParticipationAvg = avg(syncCommitteeParticipation);

    if (syncCommitteeParticipationAvg < expectedMinSyncParticipationRate) {
      errors.push([
        "node has low avg sync committee participation for epoch",
        {
          syncCommitteeParticipationAvg,
          expectedMinSyncParticipationRate,
        },
      ]);
    }

    return errors;
  },
};
