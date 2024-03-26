import {CachedBeaconStateElectra} from "../types.js";
import {increaseBalance} from "../util/balance.js";
import {getActivationExitChurnLimit} from "../util/validator.js";

/**
 * TODO Electra: jdoc
 */
export function processPendingBalanceDeposits(state: CachedBeaconStateElectra): void {
  const availableForProcessing = state.depositBalanceToConsume + BigInt(getActivationExitChurnLimit(state));
  let processedAmount = 0n;
  let nextDepositIndex = 0;

  for (const deposit of state.pendingBalanceDeposits.getAllReadonly()) {
    const {amount} = deposit;
    if (processedAmount + amount > availableForProcessing) {
      break;
    }
    increaseBalance(state, deposit.index, Number(amount));
    processedAmount = processedAmount + amount;
    nextDepositIndex++;
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
