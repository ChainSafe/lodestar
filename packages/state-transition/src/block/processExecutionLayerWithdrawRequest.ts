import {toHexString} from "@chainsafe/ssz";
import {electra, phase0, ssz} from "@lodestar/types";
import {
  FAR_FUTURE_EPOCH,
  MIN_ACTIVATION_BALANCE,
  PENDING_PARTIAL_WITHDRAWALS_LIMIT,
  FULL_EXIT_REQUEST_AMOUNT,
} from "@lodestar/params";

import {CachedBeaconStateElectra} from "../types.js";
import {hasCompoundingWithdrawalCredential, hasExecutionWithdrawalCredential} from "../util/electra.js";
import {getPendingBalanceToWithdraw, isActiveValidator} from "../util/validator.js";
import {computeExitEpochAndUpdateChurn} from "../util/epoch.js";
import {initiateValidatorExit} from "./initiateValidatorExit.js";

export function processExecutionLayerWithdrawRequest(
  state: CachedBeaconStateElectra,
  executionLayerWithdrawRequest: electra.ExecutionLayerWithdrawRequest
): void {
  const amount = Number(executionLayerWithdrawRequest.amount);
  const {pendingPartialWithdrawals, validators, epochCtx} = state;
  const {pubkey2index, config} = epochCtx; // TODO Electra: Use finalized+unfinalized pubkey cache from 6110
  const isFullExitRequest = amount === FULL_EXIT_REQUEST_AMOUNT;

  // If partial withdrawal queue is full, only full exits are processed
  if (pendingPartialWithdrawals.length >= PENDING_PARTIAL_WITHDRAWALS_LIMIT && !isFullExitRequest) {
    return;
  }

  const validatorIndex = pubkey2index.get(executionLayerWithdrawRequest.validatorPubkey);

  if (validatorIndex === undefined) {
    throw new Error(
      `Can't find validator index from ExecutionLayerWithdrawRequest : pubkey=${toHexString(
        executionLayerWithdrawRequest.validatorPubkey
      )}`
    );
  }

  const validator = validators.getReadonly(validatorIndex);

  if (!isValidValidator(validator, executionLayerWithdrawRequest.sourceAddress, state)) {
    return;
  }

  // TODO Electra: Consider caching pendingPartialWithdrawals
  const pendingBalanceToWithdraw = getPendingBalanceToWithdraw(state, validatorIndex);
  const validatorBalance = state.balances.get(validatorIndex);

  if (isFullExitRequest) {
    // only exit validator if it has no pending withdrawals in the queue
    if (pendingBalanceToWithdraw === 0) {
      initiateValidatorExit(state, validator);
    } else {
      // Full request can't be fulfilled because still has pending withdrawals.
      // TODO Electra: add log here
    }
    return;
  }

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

    const pendingPartialWithdrawal = ssz.electra.PartialWithdrawal.toViewDU({
      index: validatorIndex,
      amount: amountToWithdraw,
      withdrawableEpoch,
    });
    state.pendingPartialWithdrawals.push(pendingPartialWithdrawal);
  }
}

function isValidValidator(
  validator: phase0.Validator,
  sourceAddress: Uint8Array,
  state: CachedBeaconStateElectra
): boolean {
  const {withdrawalCredentials} = validator;
  const addressStr = toHexString(withdrawalCredentials.slice(12));
  const sourceAddressStr = toHexString(sourceAddress);
  const {epoch: currentEpoch, config} = state.epochCtx;

  return (
    hasExecutionWithdrawalCredential(withdrawalCredentials) &&
    addressStr === sourceAddressStr &&
    isActiveValidator(validator, currentEpoch) &&
    validator.exitEpoch === FAR_FUTURE_EPOCH &&
    currentEpoch >= validator.activationEpoch + config.SHARD_COMMITTEE_PERIOD
  );
}
