/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import BN from "bn.js";
import {signingRoot} from "@chainsafe/ssz";

import {
  BeaconState,
  Transfer,
} from "../../../types";

import {
  BLS_WITHDRAWAL_PREFIX_BYTE,
  Domain,
  MIN_DEPOSIT_AMOUNT,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
} from "../../../constants";

import bls from "@chainsafe/bls-js";

import {hash} from "../../../util/crypto";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
  decreaseBalance,
  increaseBalance,
} from "../util";

/**
 * Process ``Transfer`` operation.
 */
export function processTransfer(state: BeaconState, transfer: Transfer): void {
  // Verify the amount and fee aren't individually too big (for anti-overflow purposes)
  const senderBalance = state.balances[transfer.sender];
  assert(senderBalance.gte(transfer.amount));
  assert(senderBalance.gte(transfer.fee));
  // A transfer is valid in only one slot
  assert(state.slot === transfer.slot);
  // Sender must be not yet eligible for activation, withdrawn, or transfer
  // balance over MAX_EFFECTIVE_BALANCE
  assert(
    state.validatorRegistry[transfer.sender].activationEligibilityEpoch === FAR_FUTURE_EPOCH ||
    getCurrentEpoch(state) >= state.validatorRegistry[transfer.sender].withdrawableEpoch ||
    transfer.amount.add(transfer.fee).add(new BN(MAX_EFFECTIVE_BALANCE))
      .lte(state.balances[transfer.sender])
  );
  // Verify that the pubkey is valid
  assert(state.validatorRegistry[transfer.sender].withdrawalCredentials.equals(
    Buffer.concat([BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)])));
  // Verify that the signature is valid
  assert(bls.verify(
    transfer.pubkey,
    signingRoot(transfer, Transfer),
    transfer.signature,
    getDomain(state, Domain.TRANSFER),
  ));
  // Process the transfer
  decreaseBalance(state, transfer.sender, transfer.amount.add(transfer.fee));
  increaseBalance(state, transfer.recipient, transfer.amount);
  increaseBalance(state, getBeaconProposerIndex(state), transfer.fee);
  // Verify balances are not dust
  assert(!(
    (new BN(0)).lt(state.balances[transfer.sender]) &&
    state.balances[transfer.sender].lt(MIN_DEPOSIT_AMOUNT)
  ));
  assert(!(
    (new BN(0)).lt(state.balances[transfer.recipient]) &&
    state.balances[transfer.recipient].lt(MIN_DEPOSIT_AMOUNT)
  ));
}
