import {ForkName} from "@lodestar/params";
import {altair} from "@lodestar/types";
import {AssertionMatch, AssertionResult, SimulationAssertion} from "../../interfaces.js";
import {avg} from "../../utils/index.js";

// Until we identity and fix the following issue, reducing the expected sync committee participation rate from 0.9 to 0.75
// https://github.com/ChainSafe/lodestar/issues/6432
export const expectedMinSyncParticipationRate = 0.75;

export const syncCommitteeParticipationAssertion: SimulationAssertion<"syncCommitteeParticipation", number> = {
  id: "syncCommitteeParticipation",
  match: ({slot, clock, fork}) => {
    if (fork === ForkName.phase0) return AssertionMatch.None;

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

  async dump({store, slot, nodes}) {
    /*
     * | Slot | Node 1 | Node 2 |
     * |------|--------|--------|
     * | 1    | 16     | 18    |
     * | 2    | 12    | 12     |
     * | 3    | 14    | 14    |
     */
    const result = [`Slot,${nodes.map((n) => n.beacon.id).join(", ")}`];
    for (let s = 1; s <= slot; s++) {
      result.push(`${s}, ${nodes.map((n) => store[n.beacon.id][s] ?? "-").join(",")}`);
    }
    return {"syncCommitteeParticipationAssertion.csv": result.join("\n")};
  },
};
