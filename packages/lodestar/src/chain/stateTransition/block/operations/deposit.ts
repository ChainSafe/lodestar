/**
 * @module chain/stateTransition/block
 */

import assert from "assert";
import {hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";

import {BeaconState, Deposit, Validator} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DomainType,
  FAR_FUTURE_EPOCH,
} from "../../../../constants";
import {bnMin} from "../../../../util/math";
import {verifyMerkleBranch} from "../../../../util/merkleTree";

import {computeDomain, increaseBalance} from "../../util";

// See https://github.com/ethereum/eth2.0-specs/blob/v0.8.1/specs/core/0_beacon-chain.md#deposits

/**
 * Process an Eth1 deposit, registering a validator or increasing its balance.
 */
export function processDeposit(
  config: IBeaconConfig,
  state: BeaconState,
  deposit: Deposit
): void {
  // Verify the Merkle branch
  assert(verifyMerkleBranch(
    hashTreeRoot(deposit.data, config.types.DepositData),
    deposit.proof,
    DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    state.eth1DepositIndex,
    state.eth1Data.depositRoot,
  ));

  // Deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey;
  const amount = deposit.data.amount;
  const validatorIndex = state.validators.findIndex((v) => v.pubkey.equals(pubkey));
  if (validatorIndex === -1) {
    // Verify the deposit signature (proof of possession)
    // Note: The deposit contract does not check signatures.
    // Note: Deposits are valid across forks, thus the deposit domain is retrieved directly from `computeDomain`.
    if (!bls.verify(
      pubkey,
      signingRoot(deposit.data, config.types.DepositData),
      deposit.data.signature,
      computeDomain(DomainType.DEPOSIT),
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
        amount.sub(amount.mod(config.params.EFFECTIVE_BALANCE_INCREMENT)),
        config.params.MAX_EFFECTIVE_BALANCE
      ),
    };
    state.validators.push(validator);
    state.balances.push(amount);
  } else {
    // Increase balance by deposit amount
    increaseBalance(state, validatorIndex, amount);
  }
}
