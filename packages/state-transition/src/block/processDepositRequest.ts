import {PublicKey, Signature, verify, verifyMultipleAggregateSignatures} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_DEPOSIT, FAR_FUTURE_EPOCH, ForkSeq, UNSET_DEPOSIT_REQUESTS_START_INDEX} from "@lodestar/params";
import {BLSPubkey, BuilderIndex, Bytes32, Epoch, UintNum64, electra, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateElectra, CachedBeaconStateGloas} from "../types.js";
import {findBuilderIndexByPubkey, isBuilderWithdrawalCredential} from "../util/gloas.js";
import {computeDomain, computeEpochAtSlot, computeSigningRoot, isValidatorKnown} from "../util/index.js";
import {PendingDepositsLookup} from "../util/pendingDepositsLookup.js";
import {isValidDepositSignature} from "./processDeposit.js";

/**
 * Apply a deposit for a builder. Either increases balance for existing builder or adds new builder to registry.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-apply_deposit_for_builder
 */
export function applyDepositForBuilder(
  state: CachedBeaconStateGloas,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  signature: Bytes32,
  slot: UintNum64
): void {
  const builderIndex = findBuilderIndexByPubkey(state, pubkey);

  if (builderIndex !== null) {
    // Existing builder - increase balance
    const builder = state.builders.get(builderIndex);
    builder.balance += amount;
  } else {
    // New builder - verify signature and add to registry
    if (isValidDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature)) {
      addBuilderToRegistry(state, pubkey, withdrawalCredentials, amount, slot);
    }
  }
}

/**
 * Create a new builder registry entry (a `Builder` view) from a deposit.
 */
function buildNewBuilder(pubkey: BLSPubkey, withdrawalCredentials: Bytes32, amount: UintNum64, depositEpoch: Epoch) {
  return ssz.gloas.Builder.toViewDU({
    pubkey,
    version: withdrawalCredentials[0],
    executionAddress: withdrawalCredentials.subarray(12),
    balance: amount,
    depositEpoch,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
  });
}

/**
 * Add a new builder to the builders registry.
 * Reuses slots from exited and fully withdrawn builders if available.
 */
function addBuilderToRegistry(
  state: CachedBeaconStateGloas,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  slot: UintNum64
): void {
  const currentEpoch = computeEpochAtSlot(state.slot);
  const depositEpoch = computeEpochAtSlot(slot);

  // Try to find a reusable slot from an exited builder with zero balance
  let builderIndex = state.builders.length;
  for (let i = 0; i < state.builders.length; i++) {
    const builder = state.builders.getReadonly(i);
    if (builder.withdrawableEpoch <= currentEpoch && builder.balance === 0) {
      builderIndex = i;
      break;
    }
  }

  const newBuilder = buildNewBuilder(pubkey, withdrawalCredentials, amount, depositEpoch);

  if (builderIndex < state.builders.length) {
    // Reuse existing slot
    state.builders.set(builderIndex, newBuilder);
  } else {
    // Append to end
    state.builders.push(newBuilder);
  }
}

/**
 * Apply a deposit for a builder whose registry index is already known by the caller.
 *
 * This is called at gloas fork transition only. The signature is NOT verified here — the
 * caller (`onboardBuildersFromPendingDeposits`) batch-verifies new-builder signatures
 * before calling this. A new builder is appended directly, since the slot-reuse scan in
 * `addBuilderToRegistry` is unnecessary at the fork (`state.builders` starts empty).
 */
export function applyDepositForBuilderIndex(
  state: CachedBeaconStateGloas,
  builderIndex: BuilderIndex | null,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  slot: UintNum64
): void {
  if (builderIndex !== null) {
    // Existing builder - increase balance
    state.builders.get(builderIndex).balance += amount;
    return;
  }

  // New builder - signature already verified by the caller; append directly
  state.builders.push(buildNewBuilder(pubkey, withdrawalCredentials, amount, computeEpochAtSlot(slot)));
}

/**
 * Verify a batch of deposit signatures. Tries batch verification first; on failure falls
 * back to verifying each deposit individually so the valid deposits in a batch that
 * contains an invalid one are still identified. Returns a boolean per input deposit.
 */
export function verifyDepositSignatures(config: BeaconConfig, deposits: electra.PendingDeposit[]): boolean[] {
  const results = new Array<boolean>(deposits.length).fill(false);
  // Deposit signatures use a fork-agnostic domain, see `isValidDepositSignature`
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);

  const signatureSets: {pk: PublicKey; msg: Uint8Array; sig: Signature}[] = [];
  const signatureSetDepositIndices: number[] = [];
  for (let i = 0; i < deposits.length; i++) {
    const {pubkey, withdrawalCredentials, amount, signature} = deposits[i];
    let pk: PublicKey;
    let sig: Signature;
    try {
      // Deposit pubkeys and signatures are untrusted: must be group + infinity checked
      pk = PublicKey.fromBytes(pubkey, true);
      sig = Signature.fromBytes(signature, true);
    } catch (_) {
      // Malformed pubkey or signature - invalid deposit, results[i] stays false
      continue;
    }
    const msg = computeSigningRoot(ssz.phase0.DepositMessage, {pubkey, withdrawalCredentials, amount}, domain);
    signatureSets.push({pk, msg, sig});
    signatureSetDepositIndices.push(i);
  }

  if (signatureSets.length === 0) {
    return results;
  }

  let batchValid: boolean;
  try {
    batchValid =
      signatureSets.length >= 2
        ? verifyMultipleAggregateSignatures(signatureSets)
        : verify(signatureSets[0].msg, signatureSets[0].pk, signatureSets[0].sig);
  } catch (_) {
    batchValid = false;
  }

  if (batchValid) {
    // Batch passed - every deposit with a well-formed pubkey and signature is valid
    for (const depositIndex of signatureSetDepositIndices) {
      results[depositIndex] = true;
    }
  } else {
    // Batch failed: at least one signature is invalid - verify each individually
    for (let s = 0; s < signatureSets.length; s++) {
      results[signatureSetDepositIndices[s]] = verify(signatureSets[s].msg, signatureSets[s].pk, signatureSets[s].sig);
    }
  }

  return results;
}

// TODO GLOAS: the PendingDepositsLookup is currently scoped to a single envelope of
// deposit-requests. We can track it as ephemeral within EpochCache and transfer to the next block
// transition to reuse cached signature verifications.
// See https://github.com/ChainSafe/lodestar/issues/9181
export function processDepositRequest(
  fork: ForkSeq,
  state: CachedBeaconStateElectra | CachedBeaconStateGloas,
  depositRequest: electra.DepositRequest,
  pendingDepositsLookup?: PendingDepositsLookup
): void {
  const {pubkey, withdrawalCredentials, amount, signature} = depositRequest;

  if (fork >= ForkSeq.gloas) {
    const stateGloas = state as CachedBeaconStateGloas;
    const lookup = pendingDepositsLookup ?? PendingDepositsLookup.build(stateGloas);
    const pubkeyHex = toPubkeyHex(pubkey);
    const builderIndex = findBuilderIndexByPubkey(stateGloas, pubkey);
    const validatorIndex = state.epochCtx.getValidatorIndex(pubkey);

    const isBuilder = builderIndex !== null;
    const isValidator = isValidatorKnown(state, validatorIndex);

    if (isBuilder) {
      // Top up an existing builder regardless of withdrawal credential prefix
      applyDepositForBuilder(stateGloas, pubkey, withdrawalCredentials, amount, signature, state.slot);
      return;
    }

    // Only check the (expensive) "pending validator" condition when needed
    if (
      isBuilderWithdrawalCredential(withdrawalCredentials) &&
      !isValidator &&
      !lookup.hasPendingValidator(state.config, pubkeyHex)
    ) {
      applyDepositForBuilder(stateGloas, pubkey, withdrawalCredentials, amount, signature, state.slot);
      return;
    }

    const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
      pubkey,
      withdrawalCredentials,
      amount,
      signature,
      slot: state.slot,
    });
    // Keep the lookup in sync with state.pendingDeposits so later deposit-requests
    // in the same envelope see this deposit
    lookup.add(pendingDeposit, pubkeyHex);
    state.pendingDeposits.push(pendingDeposit);
    return;
  }

  // Pre-Gloas (Electra) path
  if (state.depositRequestsStartIndex === UNSET_DEPOSIT_REQUESTS_START_INDEX) {
    state.depositRequestsStartIndex = depositRequest.index;
  }

  // Add validator deposits to the queue
  const pendingDeposit = ssz.electra.PendingDeposit.toViewDU({
    pubkey,
    withdrawalCredentials,
    amount,
    signature,
    slot: state.slot,
  });
  state.pendingDeposits.push(pendingDeposit);
}
