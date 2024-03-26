import {CachedBeaconStateElectra} from "../types.js";
import { increaseBalance } from "../util/balance.js";

/**
 * TODO Electra: jdoc
 */
export function processPendingBalanceDeposits(state: CachedBeaconStateElectra): void {
  const availableForProcessing = state.depositBalanceToConsume + 0n; // TODO Electra: get_activation_exit_churn_limit
  let processedAmount = 0n;
  let nextDepositIndex = 0;

  for (const deposit of state.pendingBalanceDeposits.getAllReadonly()) {
    const {amount} = deposit
    if (processedAmount + amount > availableForProcessing) {
      break;
    }
    increaseBalance(state, deposit.index, Number(amount));
    processedAmount = processedAmount + amount;
    nextDepositIndex ++;
  }

  // TODO Electra: Impl slicing for ssz
  const remainingPendingBalanceDeposits = [];
  // const remainingPendingBalanceDeposits = state.pendingBalanceDeposits.slice()
  // state.pendingBalanceDeposits = remainingPendingBalanceDeposits
  

  if (remainingPendingBalanceDeposits.length === 0) {
    state.depositBalanceToConsume = 0n;
  } else {
    state.depositBalanceToConsume = availableForProcessing - processedAmount;
  }
}
