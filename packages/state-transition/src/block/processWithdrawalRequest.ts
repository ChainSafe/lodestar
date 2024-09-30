import {electra, phase0, ssz} from "@lodestar/types";
import {
  FAR_FUTURE_EPOCH,
  MIN_ACTIVATION_BALANCE,
  PENDING_PARTIAL_WITHDRAWALS_LIMIT,
  FULL_EXIT_REQUEST_AMOUNT,
  ForkSeq,
} from "@lodestar/params";

import {toHex} from "@lodestar/utils";
import {CachedBeaconStateElectra} from "../types.js";
import {hasCompoundingWithdrawalCredential, hasExecutionWithdrawalCredential} from "../util/electra.js";
import {getPendingBalanceToWithdraw, isActiveValidator} from "../util/validator.js";
import {computeExitEpochAndUpdateChurn} from "../util/epoch.js";
import {initiateValidatorExit} from "./initiateValidatorExit.js";

export function processWithdrawalRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra,
  withdrawalRequest: electra.WithdrawalRequest
): void {
  const amount = Number(withdrawalRequest.amount);
  const {pendingPartialWithdrawals, validators, epochCtx} = state;
  // no need to use unfinalized pubkey cache from 6110 as validator won't be active anyway
  const {pubkey2index, config} = epochCtx;
  const isFullExitRequest = amount === FULL_EXIT_REQUEST_AMOUNT;

  // If partial withdrawal queue is full, only full exits are processed
  if (pendingPartialWithdrawals.length >= PENDING_PARTIAL_WITHDRAWALS_LIMIT && !isFullExitRequest) {
    return;
  }

  // bail out if validator is not in beacon state
  // note that we don't need to check for 6110 unfinalized vals as they won't be eligible for withdraw/exit anyway
  const validatorIndex = pubkey2index.get(withdrawalRequest.validatorPubkey);
  if (validatorIndex === null) {
    return;
  }

  const validator = validators.get(validatorIndex);
  if (!isValidatorEligibleForWithdrawOrExit(validator, withdrawalRequest.sourceAddress, state)) {
    return;
  }

  // TODO Electra: Consider caching pendingPartialWithdrawals
  const pendingBalanceToWithdraw = getPendingBalanceToWithdraw(state, validatorIndex);
  const validatorBalance = state.balances.get(validatorIndex);

  if (isFullExitRequest) {
    // only exit validator if it has no pending withdrawals in the queue
    if (pendingBalanceToWithdraw === 0) {
      initiateValidatorExit(fork, state, validator);
    }
    return;
  }

  // partial withdrawal request
  const hasSufficientEffectiveBalance = validator.effectiveBalance >= MIN_ACTIVATION_BALANCE;
  const hasExcessBalance = validatorBalance > MIN_ACTIVATION_BALANCE + pendingBalanceToWithdraw;

  // Only allow partial withdrawals with compounding withdrawal credentials
  if (
    hasCompoundingWithdrawalCredential(validator.withdrawalCredentials) &&
    hasSufficientEffectiveBalance &&
    hasExcessBalance
  ) {
    const amountToWithdraw = BigInt(
      Math.min(validatorBalance - MIN_ACTIVATION_BALANCE - pendingBalanceToWithdraw, amount)
    );
    const exitQueueEpoch = computeExitEpochAndUpdateChurn(state, amountToWithdraw);
    const withdrawableEpoch = exitQueueEpoch + config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

    const pendingPartialWithdrawal = ssz.electra.PendingPartialWithdrawal.toViewDU({
      index: validatorIndex,
      amount: amountToWithdraw,
      withdrawableEpoch,
    });
    state.pendingPartialWithdrawals.push(pendingPartialWithdrawal);
  }
}

function isValidatorEligibleForWithdrawOrExit(
  validator: phase0.Validator,
  sourceAddress: Uint8Array,
  state: CachedBeaconStateElectra
): boolean {
  const {withdrawalCredentials} = validator;
  const addressStr = toHex(withdrawalCredentials.subarray(12));
  const sourceAddressStr = toHex(sourceAddress);
  const {epoch: currentEpoch, config} = state.epochCtx;

  return (
    hasExecutionWithdrawalCredential(withdrawalCredentials) &&
    addressStr === sourceAddressStr &&
    isActiveValidator(validator, currentEpoch) &&
    validator.exitEpoch === FAR_FUTURE_EPOCH &&
    currentEpoch >= validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD
  );
}
