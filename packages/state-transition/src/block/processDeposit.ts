import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {phase0, ssz} from "@lodestar/types";
import {verifyMerkleBranch} from "@lodestar/utils";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_DEPOSIT,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
} from "@lodestar/params";

import {ZERO_HASH} from "../constants/index.js";
import {computeDomain, computeSigningRoot, increaseBalance} from "../util/index.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStatePhase0,
  CachedBeaconStateCapella,
  CachedBeaconStateAltair,
} from "../types.js";

/**
 * Process a Deposit operation. Potentially adds a new validator to the registry. Mutates the validators and balances
 * trees, pushing contigious values at the end.
 *
 * PERF: Work depends on number of Deposit per block. On regular networks the average is 0 / block.
 */
export function processDeposit(fork: ForkSeq, state: CachedBeaconStateAllForks, deposit: phase0.Deposit): void {
  const {config, validators, epochCtx} = state;

  // verify the merkle branch
  if (
    !verifyMerkleBranch(
      ssz.phase0.DepositData.hashTreeRoot(deposit.data),
      deposit.proof,
      DEPOSIT_CONTRACT_TREE_DEPTH + 1,
      state.eth1DepositIndex,
      state.eth1Data.depositRoot
    )
  ) {
    throw new Error("Deposit has invalid merkle proof");
  }

  // deposits must be processed in order
  state.eth1DepositIndex += 1;

  const pubkey = deposit.data.pubkey; // Drop tree
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
      const signature = bls.Signature.fromBytes(deposit.data.signature, CoordType.affine, true);
      if (!signature.verify(publicKey, signingRoot)) {
        return;
      }
    } catch (e) {
      return; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
    }

    // add validator and balance entries
    const effectiveBalance = Math.min(amount - (amount % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);
    if (fork < ForkSeq.capella) {
      (validators as CachedBeaconStatePhase0["validators"]).push(
        ssz.phase0.Validator.toViewDU({
          pubkey,
          withdrawalCredentials: deposit.data.withdrawalCredentials,
          activationEligibilityEpoch: FAR_FUTURE_EPOCH,
          activationEpoch: FAR_FUTURE_EPOCH,
          exitEpoch: FAR_FUTURE_EPOCH,
          withdrawableEpoch: FAR_FUTURE_EPOCH,
          effectiveBalance,
          slashed: false,
        })
      );
    } else {
      (validators as CachedBeaconStateCapella["validators"]).push(
        ssz.capella.Validator.toViewDU({
          pubkey,
          withdrawalCredentials: deposit.data.withdrawalCredentials,
          activationEligibilityEpoch: FAR_FUTURE_EPOCH,
          activationEpoch: FAR_FUTURE_EPOCH,
          exitEpoch: FAR_FUTURE_EPOCH,
          withdrawableEpoch: FAR_FUTURE_EPOCH,
          effectiveBalance,
          slashed: false,
          // This field is removed in the latest spec, but is present in 1.2.0 set to 0
          fullyWithdrawnEpoch: 0,
        })
      );
    }
    state.balances.push(amount);

    const validatorIndex = validators.length - 1;
    // Updating here is better than updating at once on epoch transition
    // - Simplify genesis fn applyDeposits(): effectiveBalanceIncrements is populated immediately
    // - Keep related code together to reduce risk of breaking this cache
    // - Should have equal performance since it sets a value in a flat array
    epochCtx.effectiveBalanceIncrementsSet(validatorIndex, effectiveBalance);

    // now that there is a new validator, update the epoch context with the new pubkey
    epochCtx.addPubkey(validatorIndex, pubkey);

    // Only after altair:
    if (fork >= ForkSeq.altair) {
      const stateAltair = state as CachedBeaconStateAltair;

      stateAltair.inactivityScores.push(0);

      // add participation caches
      stateAltair.previousEpochParticipation.push(0);
      stateAltair.currentEpochParticipation.push(0);
    }
  } else {
    // increase balance by deposit amount
    increaseBalance(state, cachedIndex, amount);
  }
}
