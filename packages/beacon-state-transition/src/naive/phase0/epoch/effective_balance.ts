import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0} from "@chainsafe/lodestar-types";
import {bigIntMin} from "@chainsafe/lodestar-utils";

export function processEffectiveBalanceUpdates(config: IBeaconConfig, state: phase0.BeaconState): void {
  // Update effective balances with hysteresis
  let index = 0;
  for (const validator of state.validators) {
    const balance = state.balances[index];
    const HYSTERESIS_INCREMENT = config.params.EFFECTIVE_BALANCE_INCREMENT / BigInt(config.params.HYSTERESIS_QUOTIENT);
    const DOWNWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(config.params.HYSTERESIS_DOWNWARD_MULTIPLIER);
    const UPWARD_THRESHOLD = HYSTERESIS_INCREMENT * BigInt(config.params.HYSTERESIS_UPWARD_MULTIPLIER);
    if (
      balance + DOWNWARD_THRESHOLD < validator.effectiveBalance ||
      validator.effectiveBalance + UPWARD_THRESHOLD < balance
    ) {
      state.validators[index] = {
        ...validator,
        effectiveBalance: bigIntMin(
          balance - (balance % config.params.EFFECTIVE_BALANCE_INCREMENT),
          config.params.MAX_EFFECTIVE_BALANCE
        ),
      };
    }
    index++;
  }
}
