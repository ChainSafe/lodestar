import {FAR_FUTURE_EPOCH, ForkSeq, GENESIS_SLOT, MAX_PENDING_DEPOSITS_PER_EPOCH} from "@lodestar/params";
import {PendingDeposit} from "@lodestar/types/lib/electra/types.js";
import {CachedBeaconStateElectra, EpochTransitionCache} from "../types.js";
import {increaseBalance} from "../util/balance.js";
import {getActivationExitChurnLimit} from "../util/validator.js";
import {computeStartSlotAtEpoch} from "../util/epoch.js";
import {addValidatorToRegistry, isValidDepositSignature} from "../block/processDeposit.js";

/**
 * Starting from Electra:
 * Process pending balance deposits from state subject to churn limit and depsoitBalanceToConsume.
 * For each eligible `deposit`, call `increaseBalance()`.
 * Remove the processed deposits from `state.pendingDeposits`.
 * Update `state.depositBalanceToConsume` for the next epoch
 *
 * TODO Electra: Update ssz library to support batch push to `pendingDeposits`
 */
export function processPendingDeposits(state: CachedBeaconStateElectra, cache: EpochTransitionCache): void {
  const nextEpoch = state.epochCtx.epoch + 1;
  const availableForProcessing = state.depositBalanceToConsume + BigInt(getActivationExitChurnLimit(state.epochCtx));
  let processedAmount = 0;
  let nextDepositIndex = 0;
  const depositsToPostpone = [];
  let isChurnLimitReached = false;
  const finalizedSlot = computeStartSlotAtEpoch(state.finalizedCheckpoint.epoch);

  for (const deposit of state.pendingDeposits.getAllReadonly()) {
    // Do not process deposit requests if Eth1 bridge deposits are not yet applied.
    if (
      // Is deposit request
      deposit.slot > GENESIS_SLOT &&
      // There are pending Eth1 bridge deposits
      state.eth1DepositIndex < state.depositRequestsStartIndex
    ) {
      break;
    }

    // Check if deposit has been finalized, otherwise, stop processing.
    if (deposit.slot > finalizedSlot) {
      break;
    }

    // Check if number of processed deposits has not reached the limit, otherwise, stop processing.
    if (nextDepositIndex >= MAX_PENDING_DEPOSITS_PER_EPOCH) {
      break;
    }

    // Read validator state
    let isValidatorExited = false;
    let isValidatorWithdrawn = false;

    const validatorIndex = state.epochCtx.getValidatorIndex(deposit.pubkey);
    if (validatorIndex !== null) {
      const validator = state.validators.getReadonly(validatorIndex);
      isValidatorExited = validator.exitEpoch < FAR_FUTURE_EPOCH;
      isValidatorWithdrawn = validator.withdrawableEpoch < nextEpoch;
    }

    if (isValidatorWithdrawn) {
      // Deposited balance will never become active. Increase balance but do not consume churn
      applyPendingDeposit(state, deposit, cache);
    } else if (isValidatorExited) {
      // Validator is exiting, postpone the deposit until after withdrawable epoch
      depositsToPostpone.push(deposit);
    } else {
      // Check if deposit fits in the churn, otherwise, do no more deposit processing in this epoch.
      isChurnLimitReached = processedAmount + deposit.amount > availableForProcessing;
      if (isChurnLimitReached) {
        break;
      }
      // Consume churn and apply deposit.
      processedAmount += deposit.amount;
      applyPendingDeposit(state, deposit, cache);
    }

    // Regardless of how the deposit was handled, we move on in the queue.
    nextDepositIndex++;
  }

  const remainingPendingDeposits = state.pendingDeposits.sliceFrom(nextDepositIndex);
  state.pendingDeposits = remainingPendingDeposits;

  // TODO Electra: add a function in ListCompositeTreeView to support batch push operation
  for (const deposit of depositsToPostpone) {
    state.pendingDeposits.push(deposit);
  }

  // Accumulate churn only if the churn limit has been hit.
  if (isChurnLimitReached) {
    state.depositBalanceToConsume = availableForProcessing - BigInt(processedAmount);
  } else {
    state.depositBalanceToConsume = 0n;
  }
}

function applyPendingDeposit(
  state: CachedBeaconStateElectra,
  deposit: PendingDeposit,
  cache: EpochTransitionCache
): void {
  const validatorIndex = state.epochCtx.getValidatorIndex(deposit.pubkey);
  const {pubkey, withdrawalCredentials, amount, signature} = deposit;
  const cachedBalances = cache.balances;

  if (validatorIndex === null) {
    // Verify the deposit signature (proof of possession) which is not checked by the deposit contract
    if (isValidDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addValidatorToRegistry(ForkSeq.electra, state, pubkey, withdrawalCredentials, amount);
    }
  } else {
    // Increase balance
    increaseBalance(state, validatorIndex, amount);
    if (cachedBalances) {
      cachedBalances[validatorIndex] += amount;
    }
  }
}
