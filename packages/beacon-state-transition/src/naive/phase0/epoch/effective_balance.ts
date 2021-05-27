import {
  EFFECTIVE_BALANCE_INCREMENT,
  HYSTERESIS_DOWNWARD_MULTIPLIER,
  HYSTERESIS_QUOTIENT,
  HYSTERESIS_UPWARD_MULTIPLIER,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";

export function processEffectiveBalanceUpdates(state: phase0.BeaconState): void {
  // Update effective balances with hysteresis
  let index = 0;
  for (const validator of state.validators) {
    const balance = state.balances[index];
    const HYSTERESIS_INCREMENT = EFFECTIVE_BALANCE_INCREMENT / BigInt(HYSTERESIS_QUOTIENT);
    const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_DOWNWARD_MULTIPLIER);
    const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(HYSTERESIS_UPWARD_MULTIPLIER);
    if (
      balance + DOWNWARD_THRESHOLD < validator.effectiveBalance ||
      validator.effectiveBalance + UPWARD_THRESHOLD < balance
    ) {
      state.validators[index] = {
        ...validator,
        effectiveBalance: bigIntMin(balance - (balance % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE),
      };
    }
    index++;
  }
}
