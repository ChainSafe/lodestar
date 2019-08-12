/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import BN from "bn.js";
import {hash, signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";

import {
  BeaconState,
  Transfer,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  DomainType,
  FAR_FUTURE_EPOCH,
} from "../../../../constants";
import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
  decreaseBalance,
  increaseBalance,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#transfers

/**
 * Process ``Transfer`` operation.
 */
export function processTransfer(
  config: IBeaconConfig,
  state: BeaconState,
  transfer: Transfer
): void {
  // Verify the balance the covers amount and fee
  const senderBalance = state.balances[transfer.sender];
  assert(senderBalance.gte(transfer.amount.add(transfer.fee)));
  // A transfer is valid in only one slot
  assert(state.slot === transfer.slot);
  // Sender must satisfy at least one of the following:
  assert(
    // Never have been eligible for activation
    state.validators[transfer.sender].activationEligibilityEpoch === FAR_FUTURE_EPOCH ||
    // Be withdrawable
    getCurrentEpoch(config, state) >= state.validators[transfer.sender].withdrawableEpoch ||
    // Have a balance of at least MAX_EFFECTIVE_BALANCE after the transfer
    senderBalance.gte(transfer.amount.add(transfer.fee).add(new BN(config.params.MAX_EFFECTIVE_BALANCE)))
  );
  // Verify that the pubkey is valid
  assert(state.validators[transfer.sender].withdrawalCredentials.equals(
    Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)])));
  // Verify that the signature is valid
  assert(bls.verify(
    transfer.pubkey,
    signingRoot(transfer, config.types.Transfer),
    transfer.signature,
    getDomain(config, state, DomainType.TRANSFER),
  ));
  // Process the transfer
  decreaseBalance(state, transfer.sender, transfer.amount.add(transfer.fee));
  increaseBalance(state, transfer.recipient, transfer.amount);
  increaseBalance(state, getBeaconProposerIndex(config, state), transfer.fee);
  // Verify balances are not dust
  assert(!(
    (new BN(0)).lt(state.balances[transfer.sender]) &&
    state.balances[transfer.sender].lt(config.params.MIN_DEPOSIT_AMOUNT)
  ));
  assert(!(
    (new BN(0)).lt(state.balances[transfer.recipient]) &&
    state.balances[transfer.recipient].lt(config.params.MIN_DEPOSIT_AMOUNT)
  ));
}
