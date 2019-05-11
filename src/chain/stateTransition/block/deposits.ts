/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {serialize, signingRoot} from "@chainsafe/ssz";

import {
  BeaconBlock,
  BeaconState,
  Deposit,
  DepositData,
  Validator,
} from "../../../types";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  Domain,
  FAR_FUTURE_EPOCH,
  MAX_DEPOSITS,
  EFFECTIVE_BALANCE_INCREMENT,
} from "../../../constants";

import {hash} from "../../../util/crypto";

import bls from "@chainsafe/bls-js";

import {
  getDomain,
  increaseBalance,
  verifyMerkleBranch,
} from "../util";


/**
 * Process an Eth1 deposit, registering a validator or increasing its balance.
 */
export function processDeposit(state: BeaconState, deposit: Deposit): void {
  // Verify the Merkle branch
  assert(verifyMerkleBranch(
    hash(serialize(deposit.data, DepositData)), // 48 + 32 + 8 + 96 = 184 bytes serialization
    deposit.proof,
    DEPOSIT_CONTRACT_TREE_DEPTH,
    deposit.index,
    state.latestEth1Data.depositRoot,
  ));

  // Deposits must be processed in order
  assert(deposit.index === state.depositIndex);
  state.depositIndex += 1;

  const pubkey = deposit.data.pubkey;
  const amount = deposit.data.amount;
  const validatorPubkeys = state.validatorRegistry.map((v) => v.pubkey);

  if (!validatorPubkeys.includes(pubkey)) {
    // Verify the deposit signature (proof of possession)
    if (!bls.verify(
      pubkey,
      signingRoot(deposit.data, DepositData),
      deposit.data.signature,
      getDomain(state, Domain.DEPOSIT),
    )) {
      return;
    }

    // Add validator and balance entries
    const validator: Validator = {
      pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials,
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      slashed: false,
      effectiveBalance: amount.subn(amount.modn(EFFECTIVE_BALANCE_INCREMENT)),
    };
    state.validatorRegistry.push(validator);
    state.balances.push(amount);
  } else {
    // Increase balance by deposit amount
    const index = validatorPubkeys.indexOf(pubkey);
    increaseBalance(state, index, amount);
  }
}

export default function processDeposits(state: BeaconState, block: BeaconBlock): void {
  assert(block.body.deposits.length === Math.min(MAX_DEPOSITS, state.latestEth1Data.depositCount - state.depositIndex));
  for (const deposit of block.body.deposits) {
    processDeposit(state, deposit);
  }
}
