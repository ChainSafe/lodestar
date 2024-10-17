import {COMPOUNDING_WITHDRAWAL_PREFIX, GENESIS_SLOT, MIN_ACTIVATION_BALANCE} from "@lodestar/params";
import {ValidatorIndex, ssz} from "@lodestar/types";
import {CachedBeaconStateElectra} from "../types.js";
import {G2_POINT_AT_INFINITY} from "../constants/constants.js";
import {hasEth1WithdrawalCredential} from "./capella.js";

export function hasCompoundingWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === COMPOUNDING_WITHDRAWAL_PREFIX;
}

export function hasExecutionWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return (
    hasCompoundingWithdrawalCredential(withdrawalCredentials) || hasEth1WithdrawalCredential(withdrawalCredentials)
  );
}

export function switchToCompoundingValidator(state: CachedBeaconStateElectra, index: ValidatorIndex): void {
  const validator = state.validators.get(index);

  // directly modifying the byte leads to ssz missing the modification resulting into
  // wrong root compute, although slicing can be avoided but anyway this is not going
  // to be a hot path so its better to clean slice and avoid side effects
  const newWithdrawalCredentials = validator.withdrawalCredentials.slice();
  newWithdrawalCredentials[0] = COMPOUNDING_WITHDRAWAL_PREFIX;
  validator.withdrawalCredentials = newWithdrawalCredentials;
  queueExcessActiveBalance(state, index);
}

export function queueExcessActiveBalance(state: CachedBeaconStateElectra, index: ValidatorIndex): void {
  const balance = state.balances.get(index);
  if (balance > MIN_ACTIVATION_BALANCE) {
    const validator = state.validators.getReadonly(index);
    const excessBalance = balance - MIN_ACTIVATION_BALANCE;
    state.balances.set(index, MIN_ACTIVATION_BALANCE);

    const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
      pubkey: validator.pubkey,
      withdrawalCredentials: validator.withdrawalCredentials,
      amount: excessBalance,
      // Use bls.G2_POINT_AT_INFINITY as a signature field placeholder
      signature: G2_POINT_AT_INFINITY,
      // Use GENESIS_SLOT to distinguish from a pending deposit request
      slot: GENESIS_SLOT,
    });
    state.pendingDeposits.push(pendingDeposit);
  }
}
