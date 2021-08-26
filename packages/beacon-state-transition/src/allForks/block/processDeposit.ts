import bls, {CoordType} from "@chainsafe/bls";
import {allForks, altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {verifyMerkleBranch, bigIntMin} from "@chainsafe/lodestar-utils";
import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_DEPOSIT,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
} from "@chainsafe/lodestar-params";

import {ZERO_HASH} from "../../constants";
import {computeDomain, computeSigningRoot, increaseBalance} from "../../util";
import {CachedBeaconState} from "../../allForks/util";

/**
 * Process a Deposit operation. Potentially adds a new validator to the registry. Mutates the validators and balances
 * trees, pushing contigious values at the end.
 *
 * PERF: Work depends on number of Deposit per block. On regular networks the average is 0 / block.
 */
export function processDeposit(
  fork: ForkName,
  state: CachedBeaconState<allForks.BeaconState>,
  deposit: phase0.Deposit
): void {
  const {config, validators, epochCtx} = state;
  // verify the merkle branch
  if (
    !verifyMerkleBranch(
      ssz.phase0.DepositData.hashTreeRoot(deposit.data),
      Array.from(deposit.proof).map((p) => p.valueOf() as Uint8Array),
      DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      state.eth1DepositIndex,
      state.eth1Data.depositRoot.valueOf() as Uint8Array
    )
  ) {
    throw new Error("Deposit has invalid merkle proof");
  }

  // deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey.valueOf() as Uint8Array; // Drop tree
  const amount = deposit.data.amount;
  const cachedIndex = epochCtx.pubkey2index.get(pubkey);
  if (cachedIndex === undefined || !Number.isSafeInteger(cachedIndex) || cachedIndex >= validators.length) {
    // verify the deposit signature (proof of posession) which is not checked by the deposit contract
    const depositMessage = {
      pubkey: deposit.data.pubkey, // Retain tree for hashing
      withdrawalCredentials: deposit.data.withdrawalCredentials, // Retain tree for hashing
      amount: deposit.data.amount,
    };
    // fork-agnostic domain since deposits are valid across forks
    const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
    try {
      // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed
      const publicKey = bls.PublicKey.fromBytes(pubkey, CoordType.affine, true);
      const signature = bls.Signature.fromBytes(deposit.data.signature.valueOf() as Uint8Array, CoordType.affine, true);
      if (!signature.verify(publicKey, signingRoot)) {
        return;
      }
    } catch (e) {
      return; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
    }

    // add validator and balance entries
    const effectiveBalance = bigIntMin(amount - (amount % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);
    validators.push({
      pubkey,
      withdrawalCredentials: deposit.data.withdrawalCredentials.valueOf() as Uint8Array, // Drop tree
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance: effectiveBalance,
      slashed: false,
    });
    state.balances.push(amount);
    epochCtx.effectiveBalances.push(effectiveBalance);

    // add participation caches
    state.previousEpochParticipation.pushStatus({timelyHead: false, timelySource: false, timelyTarget: false});
    state.currentEpochParticipation.pushStatus({timelyHead: false, timelySource: false, timelyTarget: false});

    if (fork === ForkName.altair) {
      (state as CachedBeaconState<altair.BeaconState>).inactivityScores.push(0);
    }

    // now that there is a new validator, update the epoch context with the new pubkey
    epochCtx.addPubkey(validators.length - 1, pubkey);
  } else {
    // increase balance by deposit amount
    increaseBalance(state, cachedIndex, amount);
  }
}
