/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";

import {BeaconBlock, BeaconState, Deposit, DepositData, Validator,} from "../../../types";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  Domain,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MAX_DEPOSITS,
  MAX_EFFECTIVE_BALANCE,
} from "../../../constants";
import {bnMin} from "../../../util/math";
import {verifyMerkleBranch} from "../../../util/merkleTree";

import bls from "@chainsafe/bls-js";

import {getDomain, increaseBalance,} from "../util";


/**
 * Process an Eth1 deposit, registering a validator or increasing its balance.
 */
export  default function processDeposit(state: BeaconState, deposit: Deposit): BeaconState {
  // Verify the Merkle branch
  assert(verifyMerkleBranch(
    hashTreeRoot(deposit.data, DepositData),
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
  const validatorIndex = state.validatorRegistry.findIndex((v) => v.pubkey.equals(pubkey));
  if (validatorIndex === -1) {
    // Verify the deposit signature (proof of possession)
    if (!bls.verify(
      pubkey,
      signingRoot(deposit.data, DepositData),
      deposit.data.signature,
      getDomain(state, Domain.DEPOSIT),
    )) {
      return state;
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
      effectiveBalance: bnMin(
        amount.sub(amount.mod(EFFECTIVE_BALANCE_INCREMENT)),
        MAX_EFFECTIVE_BALANCE
      ),
    };
    state.validatorRegistry.push(validator);
    state.balances.push(amount);
  } else {
    // Increase balance by deposit amount
    increaseBalance(state, validatorIndex, amount);
  }
  return state;
}
