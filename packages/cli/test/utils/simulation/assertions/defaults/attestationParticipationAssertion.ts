import {ApiError} from "@lodestar/api";
import {TIMELY_HEAD_FLAG_INDEX, TIMELY_SOURCE_FLAG_INDEX, TIMELY_TARGET_FLAG_INDEX} from "@lodestar/params";
import {isActiveValidator} from "@lodestar/state-transition";
import {altair} from "@lodestar/types";
import {SimulationAssertion} from "../../interfaces.js";

const TIMELY_HEAD = 1 << TIMELY_HEAD_FLAG_INDEX;
const TIMELY_SOURCE = 1 << TIMELY_SOURCE_FLAG_INDEX;
const TIMELY_TARGET = 1 << TIMELY_TARGET_FLAG_INDEX;

const expectedMinParticipationRate = 0.8;

export const attestationParticipationAssertion: SimulationAssertion<
  "attestationParticipation",
  {head: number; source: number; target: number}
> = {
  id: "attestationParticipation",
  match: ({epoch, slot, clock, forkConfig}) => {
    if (epoch < forkConfig.ALTAIR_FORK_EPOCH) return false;
    // Only assert after first slot of an epoch
    if (!clock.isFirstSlotOfEpoch(slot)) return false;

    return true;
  },

  async capture({node, clock, slot, epoch, forkConfig}) {
    // Capture data only when epoch and one extra slot passed
    if (epoch < forkConfig.ALTAIR_FORK_EPOCH || !clock.isFirstSlotOfEpoch(slot)) {
      return null;
    }

    const res = await node.cl.api.debug.getStateV2("head");
    ApiError.assert(res);
    const state = res.response.data as altair.BeaconState;

    // Attestation to be computed at the end of epoch. At that time the "currentEpochParticipation" is all set to zero
    // and we have to use "previousEpochParticipation" instead.
    const previousEpochParticipation = state.previousEpochParticipation;
    const totalAttestingBalance = {head: 0, source: 0, target: 0};
    let totalEffectiveBalance = 0;

    for (let i = 0; i < previousEpochParticipation.length; i++) {
      const {effectiveBalance} = state.validators[i];

      totalAttestingBalance.head += previousEpochParticipation[i] & TIMELY_HEAD ? effectiveBalance : 0;
      totalAttestingBalance.source += previousEpochParticipation[i] & TIMELY_SOURCE ? effectiveBalance : 0;
      totalAttestingBalance.target += previousEpochParticipation[i] & TIMELY_TARGET ? effectiveBalance : 0;

      if (isActiveValidator(state.validators[i], epoch)) {
        totalEffectiveBalance += effectiveBalance;
      }
    }

    totalAttestingBalance.head = totalAttestingBalance.head / totalEffectiveBalance;
    totalAttestingBalance.source = totalAttestingBalance.source / totalEffectiveBalance;
    totalAttestingBalance.target = totalAttestingBalance.target / totalEffectiveBalance;

    return totalAttestingBalance;
  },

  async assert({nodes, store, slot, clock}) {
    const errors: string[] = [];

    // As the attestation is computed at the end of epoch, we have to use the previous epoch
    const epoch = clock.getEpochForSlot(slot) - 1;

    for (const node of nodes) {
      const participation = store[node.cl.id][slot];

      if (participation.head < expectedMinParticipationRate) {
        errors.push(
          `node has low participation rate on head. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            participation: participation.head,
            expectedMinParticipationRate,
          })}`
        );
      }

      if (participation.source < expectedMinParticipationRate) {
        errors.push(
          `node has low participation rate on source. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            participation: participation.head,
            expectedMinParticipationRate,
          })}`
        );
      }

      if (participation.target < expectedMinParticipationRate) {
        errors.push(
          `node has low participation rate on target. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            participation: participation.head,
            expectedMinParticipationRate,
          })}`
        );
      }
    }

    return errors;
  },
};
