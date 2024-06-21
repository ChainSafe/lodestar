import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {CachedBeaconStateElectra} from "../types.js";
import {increaseBalance} from "../util/balance.js";
import {getActivationExitChurnLimit} from "../util/validator.js";
import {getCurrentEpoch} from "../util/epoch.js";

/**
 * Starting from Electra:
 * Process pending balance deposits from state subject to churn limit and depsoitBalanceToConsume.
 * For each eligible `deposit`, call `increaseBalance()`.
 * Remove the processed deposits from `state.pendingBalanceDeposits`.
 * Update `state.depositBalanceToConsume` for the next epoch
 */
export function processPendingBalanceDeposits(state: CachedBeaconStateElectra): void {
  const availableForProcessing = state.depositBalanceToConsume + BigInt(getActivationExitChurnLimit(state));
  const currentEpoch = getCurrentEpoch(state);
  let processedAmount = 0n;
  let nextDepositIndex = 0;
  const depositsToPostpone = [];

  for (const deposit of state.pendingBalanceDeposits.getAllReadonly()) {
    const {amount, index: depositIndex} = deposit;
    const validator = state.validators.get(depositIndex);

    // Validator is exiting, postpone the deposit until after withdrawable epoch
    if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
      if (currentEpoch <= validator.withdrawableEpoch) {
        depositsToPostpone.push(deposit);
      } else {
        // Deposited balance will never become active. Increase balance but do not consume churn
        increaseBalance(state, deposit.index, Number(amount));
      }
    } else {
      // Validator is not exiting, attempt to process deposit
      if (processedAmount + amount > availableForProcessing) {
        // Deposit does not fit in the churn, no more deposit processing in this epoch.
        break;
      } else {
        // Deposit fits in the churn, process it. Increase balance and consume churn.
        increaseBalance(state, deposit.index, Number(amount));
        processedAmount = processedAmount + amount;
      }
    }
    // Regardless of how the deposit was handled, we move on in the queue.
    nextDepositIndex++;
  }

  const remainingPendingBalanceDeposits = state.pendingBalanceDeposits.sliceFrom(nextDepositIndex);
  state.pendingBalanceDeposits = remainingPendingBalanceDeposits;

  if (remainingPendingBalanceDeposits.length === 0) {
    state.depositBalanceToConsume = 0n;
  } else {
    state.depositBalanceToConsume = availableForProcessing - processedAmount;
  }

  // TODO Electra: add a function in ListCompositeTreeView to support batch push operation
  for (const deposit of depositsToPostpone) {
    state.pendingBalanceDeposits.push(deposit);
  }
}
