import {Epoch, Slot, ValidatorIndex} from "@lodestar/types";
import {
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {CachedBeaconStateEIP7716} from "../types.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";

export function computePenaltyFactor(
  state: CachedBeaconStateEIP7716,
  atSlot: Slot,
  flagIndex: number
): {penaltyFactor: number; netExcessPenalty: number} {
  let netExcessPenalty = state.netExcessPenalties.get(flagIndex);
  const epoch = computeEpochAtSlot(atSlot);
  const {PENALTY_ADJUSTMENT_FACTOR, MAX_PENALTY_FACTOR, PENALTY_RECOVERY_RATE} = state.config;
  let penaltyFactor = 1;

  for (let slot = computeStartSlotAtEpoch(epoch); slot < atSlot; slot++) {
    const totalBalance = getSlotCommitteeBalance(state, slot);
    const participatingBalance = participatingBalanceSlot(state, slot, flagIndex);
    penaltyFactor = Math.min(
      Math.floor(
        ((totalBalance - participatingBalance) * PENALTY_ADJUSTMENT_FACTOR) / (netExcessPenalty * totalBalance + 1)
      ),
      MAX_PENALTY_FACTOR
    );
    netExcessPenalty = Math.max(PENALTY_RECOVERY_RATE, netExcessPenalty + penaltyFactor) - PENALTY_RECOVERY_RATE;
  }

  return {penaltyFactor, netExcessPenalty};
}

export function committeeSlotOfValidator(state: CachedBeaconStateEIP7716, index: ValidatorIndex, epoch: Epoch) {
  for (let slot = epoch * SLOTS_PER_EPOCH; slot < (epoch + 1) * SLOTS_PER_EPOCH; slot++) {
    if (index in getSlotCommittees(state, slot)) {
      return slot;
    }
  }
  throw new Error(`Validator with index ${index} is not active`);
}

export function participatingBalanceSlot(state: CachedBeaconStateEIP7716, slot: Slot, flagIndex: number) {
  const inCurrentEpoch = computeEpochAtSlot(slot) === state.epochCtx.epoch;
  const epochParticipation = inCurrentEpoch ? state.currentEpochParticipation : state.previousEpochParticipation;

  const flagBit = 1 << flagIndex;
  const participatingIndices = getSlotCommittees(state, slot).filter(
    (index) => (epochParticipation.get(index) & flagBit) === flagBit
  );

  return participatingIndices
    .map((participatingIndex) => state.balances.get(participatingIndex))
    .reduce((total, balance) => total + balance, 0);
}

export function getSlotCommittees(state: CachedBeaconStateEIP7716, slot: Slot): Uint32Array {
  const committees = state.epochCtx.getShufflingAtSlot(slot).committees[slot % SLOTS_PER_EPOCH].flat();
  // Create a new Uint32Array to flatten `committees`
  const totalLength = committees.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint32Array(totalLength);

  let offset = 0;
  for (const committee of committees) {
    result.set(committee, offset);
    offset += committee.length;
  }

  return result;
}

export function getSlotCommitteeBalance(state: CachedBeaconStateEIP7716, slot: Slot): number {
  const validatorIndices = getSlotCommittees(state, slot);

  // 32eth * 1mil / 32 is still within number range
  // WIth maxEB = 2048, total max balance could be 2^46
  return validatorIndices
    .map((validatorIndex) => state.balances.get(validatorIndex))
    .reduce((total, balance) => total + balance, 0);
}
