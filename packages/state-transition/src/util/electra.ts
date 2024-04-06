import {
  COMPOUNDING_WITHDRAWAL_PREFIX,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {ValidatorIndex, phase0, ssz} from "@lodestar/types";
import { getValidatorMaxEffectiveBalance } from "./validator";
import { hasEth1WithdrawalCredential } from "./capella";
import { CachedBeaconStateElectra } from "../types";

type ValidatorInfo = Pick<phase0.Validator, "effectiveBalance" | "withdrawableEpoch" | "withdrawalCredentials">;

export function hasCompoundingWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === COMPOUNDING_WITHDRAWAL_PREFIX;
}

export function hasExecutionWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return (
    hasCompoundingWithdrawalCredential(withdrawalCredentials) || hasEth1WithdrawalCredential(withdrawalCredentials)
  );
}

export function isFullyWithdrawableValidator(
  fork: ForkSeq,
  validatorCredential: ValidatorInfo,
  balance: number,
  epoch: number
): boolean {
  const {withdrawableEpoch, withdrawalCredentials: withdrawalCredential} = validatorCredential;
  if (fork === ForkSeq.capella || fork === ForkSeq.deneb) {
    return hasEth1WithdrawalCredential(withdrawalCredential) && withdrawableEpoch <= epoch && balance > 0;
  }

  if (fork === ForkSeq.electra) {
    return hasExecutionWithdrawalCredential(withdrawalCredential) && withdrawableEpoch <= epoch && balance > 0;
  }

  return false;
}

export function isPartiallyWithdrawableValidator(
  fork: ForkSeq,
  validatorCredential: ValidatorInfo,
  balance: number
): boolean {
  const {effectiveBalance, withdrawalCredentials: withdrawalCredential} = validatorCredential;

  if (fork < ForkSeq.capella) {
    throw new Error(`Unsupported fork`);
  }

  const validatorMaxEffectiveBalance = (fork === ForkSeq.capella || fork === ForkSeq.deneb) ? MAX_EFFECTIVE_BALANCE : getValidatorMaxEffectiveBalance(withdrawalCredential);
  const hasMaxEffectiveBalance = effectiveBalance === validatorMaxEffectiveBalance;
  const hasExcessBalance = balance > validatorMaxEffectiveBalance;

  return (
    hasEth1WithdrawalCredential(withdrawalCredential) &&
    hasMaxEffectiveBalance &&
    hasExcessBalance
  );

}

export function switchToCompoundingValidator(state: CachedBeaconStateElectra, index: ValidatorIndex): void {
  const validator = state.validators.get(index);

  if (hasEth1WithdrawalCredential(validator.withdrawalCredentials)) {
    validator.withdrawalCredentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;
    queueExcessActiveBalance(state, index);
  }
}

export function queueExcessActiveBalance(state: CachedBeaconStateElectra, index: ValidatorIndex): void {
  const balance = state.balances.get(index);
  if (balance > MIN_ACTIVATION_BALANCE) {
    const excessBalance = balance - MIN_ACTIVATION_BALANCE;
    state.balances.set(index, MIN_ACTIVATION_BALANCE);

    const pendingBalanceDeposit = ssz.electra.PendingBalanceDeposit.toViewDU({
      index,
      amount: BigInt(excessBalance),
    });
    state.pendingBalanceDeposits.push(pendingBalanceDeposit);
  }
}