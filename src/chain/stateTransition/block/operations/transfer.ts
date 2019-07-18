/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import BN from "bn.js";
import {hash, signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls-js";

import {
  BeaconState,
  Transfer,
} from "../../../../types";
import {
  Domain,
  FAR_FUTURE_EPOCH,
} from "../../../../constants";
import {IBeaconConfig} from "../../../../config";

import {
  getBeaconProposerIndex,
  getCurrentEpoch,
  getDomain,
  decreaseBalance,
  increaseBalance,
} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#transfers

/**
 * Process ``Transfer`` operation.
 */
export function processTransfer(
  config: IBeaconConfig,
  state: BeaconState,
  transfer: Transfer
): void {
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
    getCurrentEpoch(config, state) >= state.validatorRegistry[transfer.sender].withdrawableEpoch ||
    transfer.amount.add(transfer.fee).add(new BN(config.params.MAX_EFFECTIVE_BALANCE))
      .lte(state.balances[transfer.sender])
  );
  // Verify that the pubkey is valid
  assert(state.validatorRegistry[transfer.sender].withdrawalCredentials.equals(
    Buffer.concat([config.params.BLS_WITHDRAWAL_PREFIX_BYTE, hash(transfer.pubkey).slice(1)])));
  // Verify that the signature is valid
  assert(bls.verify(
    transfer.pubkey,
    signingRoot(transfer, config.types.Transfer),
    transfer.signature,
    getDomain(config, state, Domain.TRANSFER),
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
