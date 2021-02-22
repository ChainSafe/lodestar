/**
 * @module chain/stateTransition/block
 */

import bls from "@chainsafe/bls";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DEPOSIT_CONTRACT_TREE_DEPTH, FAR_FUTURE_EPOCH} from "../../../../constants";
import {computeDomain, increaseBalance, computeSigningRoot} from "../../../../util";
import {assert, bigIntMin, verifyMerkleBranch} from "@chainsafe/lodestar-utils";

/**
 * Process an Eth1 deposit, registering a validator or increasing its balance.
 */
export function processDeposit(config: IBeaconConfig, state: phase0.BeaconState, deposit: phase0.Deposit): void {
  // Verify the Merkle branch
  assert.true(
    verifyMerkleBranch(
      config.types.phase0.DepositData.hashTreeRoot(deposit.data),
      Array.from(deposit.proof).map((p) => p.valueOf() as Uint8Array),
      DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      state.eth1DepositIndex,
      state.eth1Data.depositRoot.valueOf() as Uint8Array
    ),
    "Invalid deposit merkle branch"
  );

  // Deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey;
  const amount = deposit.data.amount;
  const validatorIndex = Array.from(state.validators).findIndex((v) => config.types.BLSPubkey.equals(v.pubkey, pubkey));
  if (validatorIndex === -1) {
    const domain = computeDomain(config, config.params.DOMAIN_DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.phase0.DepositMessage, deposit.data, domain);
    // Verify the deposit signature (proof of possession)
    // Note: The deposit contract does not check signatures.
    // Note: Deposits are valid across forks, thus the deposit domain is retrieved directly from `computeDomain`.
    if (!bls.verify(pubkey.valueOf() as Uint8Array, signingRoot, deposit.data.signature.valueOf() as Uint8Array)) {
      return;
    }
    // Add validator and balance entries
    const validator: phase0.Validator = {
      pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials,
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      slashed: false,
      effectiveBalance: bigIntMin(
        amount - (amount % config.params.EFFECTIVE_BALANCE_INCREMENT),
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
