/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls-js";

import {BeaconState, Deposit, DepositData, Validator} from "@chainsafe/eth2-types";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  Domain,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/eth2-types";
import {bnMin} from "../../../../util/math";
import {verifyMerkleBranch} from "../../../../util/merkleTree";

import {getDomain, increaseBalance} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.7.1/specs/core/0_beacon-chain.md#deposits

/**
 * Process an Eth1 deposit, registering a validator or increasing its balance.
 */
export function processDeposit(state: BeaconState, deposit: Deposit): void {
  // Verify the Merkle branch
  assert(verifyMerkleBranch(
    hashTreeRoot(deposit.data, DepositData),
    deposit.proof,
    DEPOSIT_CONTRACT_TREE_DEPTH,
    state.depositIndex,
    state.latestEth1Data.depositRoot,
  ));

  // Deposits must be processed in order
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
}
