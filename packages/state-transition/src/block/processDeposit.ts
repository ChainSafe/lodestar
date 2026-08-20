import {PublicKey, Signature, verify, verifyMultipleAggregateSignatures} from "@chainsafe/lodestar-z/blst";
import {BeaconConfig} from "@lodestar/config";
import {
  DEPOSIT_CONTRACT_TREE_DEPTH,
  DOMAIN_DEPOSIT,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  GENESIS_SLOT,
  MAX_EFFECTIVE_BALANCE,
} from "@lodestar/params";
import {BLSPubkey, Bytes32, UintNum64, electra, phase0, ssz} from "@lodestar/types";
import {verifyMerkleBranch} from "@lodestar/utils";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateAllForks, CachedBeaconStateAltair, CachedBeaconStateElectra} from "../types.js";
import {
  computeDomain,
  computeSigningRoot,
  createSingleSignatureSetFromComponents,
  getMaxEffectiveBalance,
  increaseBalance,
  verifySignatureSet,
} from "../util/index.js";

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
 * Follows applyDeposit() in consensus spec. Will be used by processDeposit() and processDepositRequest()
 *
 */
export function applyDeposit(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  deposit: phase0.DepositData | electra.DepositRequest
): void {
  const {config, epochCtx, validators} = state;
  const {pubkey, withdrawalCredentials, amount, signature} = deposit;

  const cachedIndex = epochCtx.getValidatorIndex(pubkey);
  const isNewValidator = cachedIndex === null || !Number.isSafeInteger(cachedIndex) || cachedIndex >= validators.length;

  if (fork < ForkSeq.electra) {
    if (isNewValidator) {
      if (isValidDepositSignature(config, pubkey, withdrawalCredentials, amount, signature)) {
        addValidatorToRegistry(fork, state, pubkey, withdrawalCredentials, amount);
      }
    } else {
      // increase balance by deposit amount right away pre-electra
      increaseBalance(state, cachedIndex, amount);
    }
  } else {
    const stateElectra = state as CachedBeaconStateElectra;
    const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
      pubkey,
      withdrawalCredentials,
      amount,
      signature,
      slot: GENESIS_SLOT, // Use GENESIS_SLOT to distinguish from a pending deposit request
    });

    if (isNewValidator) {
      if (isValidDepositSignature(config, pubkey, withdrawalCredentials, amount, deposit.signature)) {
        addValidatorToRegistry(fork, state, pubkey, withdrawalCredentials, 0);
        stateElectra.pendingDeposits.push(pendingDeposit);
      }
    } else {
      stateElectra.pendingDeposits.push(pendingDeposit);
    }
  }
}

export function addValidatorToRegistry(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64
): void {
  const {validators, epochCtx} = state;
  // add validator and balance entries
  const effectiveBalance = Math.min(
    amount - (amount % EFFECTIVE_BALANCE_INCREMENT),
    fork < ForkSeq.electra ? MAX_EFFECTIVE_BALANCE : getMaxEffectiveBalance(withdrawalCredentials)
  );
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

  const validatorIndex = validators.length - 1;
  // TODO Electra: Review this
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

  state.balances.push(amount);
}

/**
 * Verify a single deposit signature (proof of possession). See {@link verifyDepositSignatures} for
 * the batch equivalent — the two MUST stay consistent (same domain, signing root, and checks).
 */
export function isValidDepositSignature(
  config: BeaconConfig,
  pubkey: Uint8Array,
  withdrawalCredentials: Uint8Array,
  amount: number,
  depositSignature: Uint8Array
): boolean {
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
    return verifySignatureSet(createSingleSignatureSetFromComponents(pubkey, signingRoot, depositSignature));
  } catch (_e) {
    return false; // Catch all BLS errors: failed key validation, failed signature validation, invalid signature
  }
}

/**
 * Batch equivalent of {@link isValidDepositSignature} — verify many deposit signatures at once.
 * MUST stay consistent with `isValidDepositSignature`: same fork-agnostic deposit domain, same
 * `DepositMessage` signing root, same group + infinity checks. Tries a single aggregate verify and,
 * on failure, falls back to verifying each deposit individually so the valid deposits in a batch
 * containing an invalid one are still identified. Returns a boolean per input deposit; `slot` is not
 * part of the signature check.
 *
 * Used by the pre-Gloas builder-deposit pre-verify scanner (see `preVerifyBuilderDeposits.ts`).
 */
export function verifyDepositSignatures(config: BeaconConfig, deposits: electra.PendingDeposit[]): boolean[] {
  const results = new Array<boolean>(deposits.length).fill(false);
  // fork-agnostic domain since deposits are valid across forks, matching isValidDepositSignature
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);

  const signatureSets: {pk: PublicKey; msg: Uint8Array; sig: Signature}[] = [];
  const signatureSetDepositIndices: number[] = [];
  for (let i = 0; i < deposits.length; i++) {
    const {pubkey, withdrawalCredentials, amount, signature} = deposits[i];
    let pk: PublicKey;
    let sig: Signature;
    try {
      // Parse without group/infinity checks; deferred to the verify call below so it can be
      // batched across all sets.
      pk = PublicKey.fromBytes(pubkey);
      sig = Signature.fromBytes(signature);
    } catch (_) {
      // Malformed pubkey or signature bytes - invalid deposit, results[i] stays false
      continue;
    }
    const msg = computeSigningRoot(ssz.phase0.DepositMessage, {pubkey, withdrawalCredentials, amount}, domain);
    signatureSets.push({pk, msg, sig});
    signatureSetDepositIndices.push(i);
  }

  if (signatureSets.length === 0) {
    return results;
  }

  // Deposit pubkeys and signatures are untrusted, so group + infinity checks are required.
  // The trailing (true, true) args delegate those checks to blst, amortized across the batch.
  let batchValid: boolean;
  try {
    batchValid =
      signatureSets.length >= 2
        ? verifyMultipleAggregateSignatures(signatureSets, true, true)
        : verify(signatureSets[0].msg, signatureSets[0].pk, signatureSets[0].sig, true, true);
  } catch (_) {
    batchValid = false;
  }

  if (batchValid) {
    for (const depositIndex of signatureSetDepositIndices) {
      results[depositIndex] = true;
    }
  } else {
    for (let s = 0; s < signatureSets.length; s++) {
      try {
        if (verify(signatureSets[s].msg, signatureSets[s].pk, signatureSets[s].sig, true, true)) {
          results[signatureSetDepositIndices[s]] = true;
        }
      } catch (_) {
        // invalid point / malformed → invalid signature, results[i] stays false
      }
    }
  }

  return results;
}
