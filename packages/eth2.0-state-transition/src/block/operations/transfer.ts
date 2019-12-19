/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hash, signingRoot} from "@chainsafe/ssz";
import {verify} from "@chainsafe/bls";

import {BeaconState, Transfer,} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType, FAR_FUTURE_EPOCH,} from "../../constants";
import {decreaseBalance, getBeaconProposerIndex, getCurrentEpoch, getDomain, increaseBalance,} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#transfers

/**
 * Process ``Transfer`` operation.
 */
export function processTransfer(
  config: IBeaconConfig,
  state: BeaconState,
  transfer: Transfer,
  verifySignature = true
): void {
  // Verify the balance the covers amount and fee
  const senderBalance = state.balances[transfer.sender];
  assert(senderBalance >= (transfer.amount + transfer.fee));
  // A transfer is valid in only one slot
  assert(state.slot === transfer.slot);
  // Sender must satisfy at least one of the following:
  assert(
    // Never have been eligible for activation
    state.validators[transfer.sender].activationEligibilityEpoch === FAR_FUTURE_EPOCH ||
    // Be withdrawable
    getCurrentEpoch(config, state) >= state.validators[transfer.sender].withdrawableEpoch ||
    // Have a balance of at least MAX_EFFECTIVE_BALANCE after the transfer
    senderBalance >= transfer.amount + transfer.fee + config.params.MAX_EFFECTIVE_BALANCE
  );
  // Verify that the pubkey is valid
  assert(state.validators[transfer.sender].withdrawalCredentials.equals(
    Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)])));
  // Verify that the signature is valid
  assert(!verifySignature || verify(
    transfer.pubkey,
    signingRoot(config.types.Transfer, transfer),
    transfer.signature,
    getDomain(config, state, DomainType.TRANSFER),
  ));
  // Process the transfer
  decreaseBalance(state, transfer.sender, transfer.amount + transfer.fee);
  increaseBalance(state, transfer.recipient, transfer.amount);
  increaseBalance(state, getBeaconProposerIndex(config, state), transfer.fee);
  // Verify balances are not dust
  assert(!(
    0 < (state.balances[transfer.sender]) &&
    state.balances[transfer.sender] < config.params.MIN_DEPOSIT_AMOUNT
  ));
  assert(!(
    0 < state.balances[transfer.recipient] &&
    state.balances[transfer.recipient] < config.params.MIN_DEPOSIT_AMOUNT
  ));
}
