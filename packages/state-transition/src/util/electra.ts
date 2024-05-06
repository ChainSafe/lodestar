import {
  COMPOUNDING_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  MIN_ACTIVATION_BALANCE,
} from "@lodestar/params";
import {ValidatorIndex, phase0, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra} from "../types.js";
import {getValidatorMaxEffectiveBalance} from "./validator.js";
import {hasEth1WithdrawalCredential} from "./capella.js";

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
  if (fork >= ForkSeq.electra) {
    return hasExecutionWithdrawalCredential(withdrawalCredential) && withdrawableEpoch <= epoch && balance > 0;
  } else if (fork >= ForkSeq.capella) {
    return hasEth1WithdrawalCredential(withdrawalCredential) && withdrawableEpoch <= epoch && balance > 0;
  } else {
    return false;
  }
}

export function isPartiallyWithdrawableValidator(
  fork: ForkSeq,
  validatorCredential: ValidatorInfo,
  balance: number
): boolean {
  const {effectiveBalance, withdrawalCredentials: withdrawalCredential} = validatorCredential;

  if (fork < ForkSeq.capella) {
    throw new Error(`isPartiallyWithdrawableValidator not supported at forkSeq=${fork} < ForkSeq.capella`);
  }

  const validatorMaxEffectiveBalance =
    fork === ForkSeq.capella || fork === ForkSeq.deneb
      ? MAX_EFFECTIVE_BALANCE
      : getValidatorMaxEffectiveBalance(withdrawalCredential);
  const hasMaxEffectiveBalance = effectiveBalance === validatorMaxEffectiveBalance;
  const hasExcessBalance = balance > validatorMaxEffectiveBalance;

  return hasEth1WithdrawalCredential(withdrawalCredential) && hasMaxEffectiveBalance && hasExcessBalance;
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

export function queueEntireBalanceAndResetValidator(state: CachedBeaconStateElectra, index: ValidatorIndex): void {
  const balance = state.balances.get(index);
  state.balances.set(index, 0);

  const validator = state.validators.get(index);
  validator.effectiveBalance = 0;
  validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;

  const pendingBalanceDeposit = ssz.electra.PendingBalanceDeposit.toViewDU({
    index,
    amount: BigInt(balance),
  });
  state.pendingBalanceDeposits.push(pendingBalanceDeposit);
}
