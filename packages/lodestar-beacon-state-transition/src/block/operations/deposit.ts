/**
 * @module chain/stateTransition/block
 */

import {verify} from "@chainsafe/bls";
import {BeaconState, Deposit, Validator} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DEPOSIT_CONTRACT_TREE_DEPTH, DomainType, FAR_FUTURE_EPOCH,} from "../../constants";
import {computeDomain, increaseBalance} from "../../util";
import {assert, bigIntMin, verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {computeSigningRoot} from "../../util/signingRoot";

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
    config.types.DepositData.hashTreeRoot(deposit.data),
    Array.from(deposit.proof).map((p) => p.valueOf() as Uint8Array),
    DEPOSIT_CONTRACT_TREE_DEPTH + 1,
    state.eth1DepositIndex,
    state.eth1Data.depositRoot.valueOf() as Uint8Array,
  ));

  // Deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey;
  const amount = deposit.data.amount;
  const validatorIndex = Array.from(state.validators).findIndex((v) => config.types.BLSPubkey.equals(v.pubkey, pubkey));
  if (validatorIndex === -1) {
    const domain = computeDomain(config, DomainType.DEPOSIT);
    const signingRoot = computeSigningRoot(config, config.types.DepositMessage, deposit.data, domain);
    // Verify the deposit signature (proof of possession)
    // Note: The deposit contract does not check signatures.
    // Note: Deposits are valid across forks, thus the deposit domain is retrieved directly from `computeDomain`.
    if (!verify(
      pubkey.valueOf() as Uint8Array,
      signingRoot,
      deposit.data.signature.valueOf() as Uint8Array,
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
