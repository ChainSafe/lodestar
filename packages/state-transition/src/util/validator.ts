import {Epoch, phase0, ValidatorIndex} from "@lodestar/types";
import {EFFECTIVE_BALANCE_INCREMENT, MIN_ACTIVATION_BALANCE} from "@lodestar/params";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "../types.js";

/**
 * Check if [[validator]] is active
 */
export function isActiveValidator(validator: phase0.Validator, epoch: Epoch): boolean {
  return validator.activationEpoch <= epoch && epoch < validator.exitEpoch;
}

/**
 * Check if [[validator]] is slashable
 */
export function isSlashableValidator(validator: phase0.Validator, epoch: Epoch): boolean {
  return !validator.slashed && validator.activationEpoch <= epoch && epoch < validator.withdrawableEpoch;
}

/**
 * Return the sequence of active validator indices at [[epoch]].
 *
 * NAIVE - SLOW CODE 🐢
 */
export function getActiveValidatorIndices(state: BeaconStateAllForks, epoch: Epoch): ValidatorIndex[] {
  const indices: ValidatorIndex[] = [];

  const validatorsArr = state.validators.getAllReadonlyValues();
  for (let i = 0; i < validatorsArr.length; i++) {
    if (isActiveValidator(validatorsArr[i], epoch)) {
      indices.push(i);
    }
  }

  return indices;
}

// TODO: Return mod EFFECTIVE_BALANCE_INCREMENT
// https://github.com/michaelneuder/consensus-specs/pull/3/files#r1230944685
export function getChurnLimitGwei(config: ChainForkConfig, totalActiveBalanceIncrements: number): number {
  // Number.MAX_SAFE_INTEGER / 1e9 = 9007199
  return Math.max(
    // MIN_PER_EPOCH_CHURN_LIMIT = 4, so first line is safe an number
    config.MIN_PER_EPOCH_CHURN_LIMIT * MIN_ACTIVATION_BALANCE,
    // CHURN_LIMIT_QUOTIENT = 65536 (mainnet), 4096 (gnosis), 32 (minimal)
    // Current mainnet EFFECTIVE_BALANCE_INCREMENT = 1ETH, totalActiveBalanceIncrements = 20,000,000
    //
    //           CHURN_LIMIT_QUOTIENT   totalActiveBalanceIncrements limit   max token supply
    // mainnet   65536                  590,295,000,000                      120,000,000
    // gnosis     4096                   36,893,000,000                        3,000,000
    // minimal      32                      288,000,000                              ???
    Number(
      ((BigInt(totalActiveBalanceIncrements) * BigInt(EFFECTIVE_BALANCE_INCREMENT)) /
        BigInt(config.CHURN_LIMIT_QUOTIENT)) as bigint
    )
  );
}
