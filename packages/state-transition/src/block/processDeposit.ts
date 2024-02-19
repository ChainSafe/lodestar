import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {BLSPubkey, Bytes32, UintNum64, phase0, ssz} from "@lodestar/types";
import {verifyMerkleBranch} from "@lodestar/utils";

import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_DEPOSIT,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
} from "@lodestar/params";

import {DepositData} from "@lodestar/types/lib/phase0/types.js";
import {DepositReceipt} from "@lodestar/types/lib/electra/types.js";
import {ZERO_HASH} from "../constants/index.js";
import {computeDomain, computeSigningRoot, increaseBalance} from "../util/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair} from "../types.js";

/**
 * Process a Deposit operation. Potentially adds a new validator to the registry. Mutates the validators and balances
 * trees, pushing contigious values at the end.
 *
 * PERF: Work depends on number of Deposit per block. On regular networks the average is 0 / block.
 */
export function processDeposit(fork: ForkSeq, state: CachedBeaconStateAllForks, deposit: phase0.Deposit): void {
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

  applyDeposit(fork, state, deposit.data);
}

/**
 * Adds a new validator into the registry. Or increase balance if already exist.
 * Follows applyDeposit() in consensus spec. Will be used by processDeposit() and processDepositReceipt()
 *
 */
export function applyDeposit(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  deposit: DepositData | DepositReceipt
): void {
  const {config, validators, epochCtx} = state;
  const {pubkey, withdrawalCredentials, amount} = deposit;

  const cachedIndex = epochCtx.getValidatorIndex(pubkey);
  if (cachedIndex === undefined || !Number.isSafeInteger(cachedIndex) || cachedIndex >= validators.length) {
    // verify the deposit signature (proof of posession) which is not checked by the deposit contract
    const depositMessage = {
      pubkey,
      withdrawalCredentials,
      amount,
    };
    // fork-agnostic domain since deposits are valid across forks
    const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.phase0.DepositMessage, depositMessage, domain);
    try {
      // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed
      const publicKey = bls.PublicKey.fromBytes(pubkey, CoordType.affine, true);
      const signature = bls.Signature.fromBytes(deposit.signature, CoordType.affine, true);
      if (!signature.verify(publicKey, signingRoot)) {
        return;
      }
    } catch (e) {
      return; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
    }
    addValidatorToRegistry(fork, state, pubkey, withdrawalCredentials, amount);
  } else {
    // increase balance by deposit amount
    increaseBalance(state, cachedIndex, amount);
  }
}

function addValidatorToRegistry(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64
): void {
  const {validators, epochCtx} = state;
  // add validator and balance entries
  const effectiveBalance = Math.min(amount - (amount % EFFECTIVE_BALANCE_INCREMENT), MAX_EFFECTIVE_BALANCE);
  validators.push(
    ssz.phase0.Validator.toViewDU({
      pubkey,
      withdrawalCredentials,
      activationEligibilityEpoch: FAR_FUTURE_EPOCH,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance,
      slashed: false,
    })
  );
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
}
