import {PublicKey, Signature, verify, verifyMultipleAggregateSignatures} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_DEPOSIT} from "@lodestar/params";
import {BuilderIndex, PubkeyHex, UintNum64, electra, ssz} from "@lodestar/types";
import {applyDepositForBuilder} from "../block/processDepositRequest.js";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateGloas} from "../types.js";
import {computeDomain} from "./domain.js";
import {computeSigningRoot} from "./signingRoot.js";

/** Verify queued builder deposit signatures in batches of this size. */
const BUILDER_DEPOSIT_BATCH_SIZE = 32;

/**
 * Encapsulates the queue + applier state used while onboarding builders from pending deposits.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.8/specs/gloas/fork.md#new-onboard_builders_from_pending_deposits
 *
 * New-builder deposits are verified lazily: signatures are queued and batch-verified
 * `BUILDER_DEPOSIT_BATCH_SIZE` at a time.
 */
export class OnboardBuilder {
  // Map of builder pubkey -> index in `state.builders` for builders already applied via this instance.
  private readonly builderIndexByPubkey = new Map<PubkeyHex, number>();
  // FIFO queue of new-builder deposits awaiting batch signature verification. Holds
  // distinct pubkeys; a reappearing queued pubkey force-flushes the queue first.
  private readonly queuedBuilderDeposits = new Map<PubkeyHex, electra.PendingDeposit>();

  constructor(private readonly state: CachedBeaconStateGloas) {}

  /** Builder index for a pubkey already applied by this instance, or null. */
  getBuilderIndex(pubkeyHex: PubkeyHex): number | null {
    return this.builderIndexByPubkey.get(pubkeyHex) ?? null;
  }

  /** Whether a deposit for this pubkey is currently queued for batch verification. */
  hasQueuedDeposit(pubkeyHex: PubkeyHex): boolean {
    return this.queuedBuilderDeposits.has(pubkeyHex);
  }

  /**
   * Queue a new-builder deposit for lazy batch signature verification.
   * Auto-flushes when the queue reaches BUILDER_DEPOSIT_BATCH_SIZE.
   * Stores a POJO copy of the deposit fields (caller may pass a readonly view).
   */
  addBuilderDeposit(pubkeyHex: PubkeyHex, deposit: electra.PendingDeposit): void {
    this.queuedBuilderDeposits.set(pubkeyHex, {
      pubkey: deposit.pubkey,
      withdrawalCredentials: deposit.withdrawalCredentials,
      amount: deposit.amount,
      signature: deposit.signature,
      slot: deposit.slot,
    });
    if (this.queuedBuilderDeposits.size >= BUILDER_DEPOSIT_BATCH_SIZE) {
      this.flushQueue();
    }
  }

  /** Top up an already-onboarded builder's balance. No signature verification needed. */
  topupBuilder(builderIndex: BuilderIndex, amount: UintNum64): void {
    const builder = this.state.builders.get(builderIndex);
    builder.balance += amount;
  }

  /** Batch-verify the queued deposits and apply the ones with valid signatures. */
  flushQueue(): void {
    if (this.queuedBuilderDeposits.size === 0) {
      return;
    }
    const entries = Array.from(this.queuedBuilderDeposits);
    const validResults = verifyDepositSignatures(
      this.state.config,
      entries.map(([, deposit]) => deposit)
    );
    for (let j = 0; j < entries.length; j++) {
      if (!validResults[j]) {
        continue;
      }
      const [pubkeyHex, deposit] = entries[j];
      // With direct push (no slot reuse at the fork) the builder lands at the current length
      const builderIndex = this.state.builders.length;
      applyDepositForBuilder(
        this.state,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        // signature = null means valid
        null,
        deposit.slot,
        // this is new builder, top up flow was detected below
        null,
        // no previous builders at fork transition so no need to check for reuse
        false
      );
      this.builderIndexByPubkey.set(pubkeyHex, builderIndex);
    }
    this.queuedBuilderDeposits.clear();
  }
}

/**
 * Verify a batch of deposit signatures. Tries batch verification first; on failure falls
 * back to verifying each deposit individually so the valid deposits in a batch that
 * contains an invalid one are still identified. Returns a boolean per input deposit.
 */
function verifyDepositSignatures(config: BeaconConfig, deposits: electra.PendingDeposit[]): boolean[] {
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
