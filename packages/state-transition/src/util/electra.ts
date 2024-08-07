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
  const {withdrawableEpoch, withdrawalCredentials} = validatorCredential;

  if (fork < ForkSeq.capella) {
    throw new Error(`isFullyWithdrawableValidator not supported at forkSeq=${fork} < ForkSeq.capella`);
  }
  const hasWithdrawableCredentials =
    fork >= ForkSeq.electra
      ? hasExecutionWithdrawalCredential(withdrawalCredentials)
      : hasEth1WithdrawalCredential(withdrawalCredentials);

  return hasWithdrawableCredentials && withdrawableEpoch <= epoch && balance > 0;
}

export function isPartiallyWithdrawableValidator(
  fork: ForkSeq,
  validatorCredential: ValidatorInfo,
  balance: number
): boolean {
  const {effectiveBalance, withdrawalCredentials} = validatorCredential;

  if (fork < ForkSeq.capella) {
    throw new Error(`isPartiallyWithdrawableValidator not supported at forkSeq=${fork} < ForkSeq.capella`);
  }
  const hasWithdrawableCredentials =
    fork >= ForkSeq.electra
      ? hasExecutionWithdrawalCredential(withdrawalCredentials)
      : hasEth1WithdrawalCredential(withdrawalCredentials);

  const validatorMaxEffectiveBalance =
    fork >= ForkSeq.electra ? getValidatorMaxEffectiveBalance(withdrawalCredentials) : MAX_EFFECTIVE_BALANCE;
  const hasMaxEffectiveBalance = effectiveBalance === validatorMaxEffectiveBalance;
  const hasExcessBalance = balance > validatorMaxEffectiveBalance;

  return hasWithdrawableCredentials && hasMaxEffectiveBalance && hasExcessBalance;
}

export function switchToCompoundingValidator(state: CachedBeaconStateElectra, index: ValidatorIndex): void {
  const validator = state.validators.get(index);

  if (hasEth1WithdrawalCredential(validator.withdrawalCredentials)) {
    // directly modifying the byte leads to ssz missing the modification resulting into
    // wrong root compute, although slicing can be avoided but anyway this is not going
    // to be a hot path so its better to clean slice and avoid side effects
    const newWithdrawalCredentials = validator.withdrawalCredentials.slice();
    newWithdrawalCredentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;
    validator.withdrawalCredentials = newWithdrawalCredentials;
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
  state.epochCtx.effectiveBalanceIncrementsSet(index, 0);
  validator.activationEligibilityEpoch = FAR_FUTURE_EPOCH;

  const pendingBalanceDeposit = ssz.electra.PendingBalanceDeposit.toViewDU({
    index,
    amount: BigInt(balance),
  });
  state.pendingBalanceDeposits.push(pendingBalanceDeposit);
}
