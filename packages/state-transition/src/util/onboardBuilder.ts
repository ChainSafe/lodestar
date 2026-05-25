import {PublicKey, Signature, verify, verifyMultipleAggregateSignatures} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {DOMAIN_DEPOSIT, FAR_FUTURE_EPOCH} from "@lodestar/params";
import {BLSPubkey, BuilderIndex, Bytes32, Epoch, PubkeyHex, UintNum64, electra, gloas, ssz} from "@lodestar/types";
import {toPubkeyHex} from "@lodestar/utils";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateGloas} from "../types.js";
import {computeDomain} from "./domain.js";
import {computeEpochAtSlot} from "./epoch.ts";
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
export class BatchOnboardBuilder {
  // Map of builder pubkey -> index in `state.builders` for builders already applied via this instance.
  private readonly builderIndexByPubkey: Map<PubkeyHex, BuilderIndex>;
  // FIFO queue of new-builder deposits awaiting batch signature verification. Holds
  // distinct pubkeys; a reappearing queued pubkey force-flushes the queue first.
  private readonly queuedBuilderDeposits = new Map<PubkeyHex, electra.PendingDeposit>();
  // this is use to scan for reused builder index
  private preExistingBuilders: gloas.Builder[];
  private nextReuseIndexCheck = 0;

  constructor(private readonly state: CachedBeaconStateGloas) {
    this.preExistingBuilders = this.state.builders.getAllReadonlyValues();
    this.builderIndexByPubkey = new Map();
    const currentEpoch = computeEpochAtSlot(this.state.slot);
    // Sentinel = preExistingBuilders.length means "no eligible slot found yet".
    // Since i increases monotonically, (i < firstReuseIdx) is true only until we
    // assign, so this records the FIRST eligible slot's index.
    let firstReuseIdx = this.preExistingBuilders.length;
    for (const [i, builder] of this.preExistingBuilders.entries()) {
      this.builderIndexByPubkey.set(toPubkeyHex(builder.pubkey), i);
      if (i < firstReuseIdx && isBuilderExited(builder, currentEpoch)) {
        firstReuseIdx = i;
      }
    }
    this.nextReuseIndexCheck = firstReuseIdx;
  }

  /** Builder index for a pubkey already applied by this instance, or null. */
  getAppliedBuilderIndex(pubkeyHex: PubkeyHex): number | null {
    return this.builderIndexByPubkey.get(pubkeyHex) ?? null;
  }

  /**
   * Queue a new-builder deposit for lazy batch signature verification.
   *
   * Flush conditions:
   *   - reuse is still possible: applying NOW preserves eager (spec) ordering
   *     against any subsequent topup that this onboard might displace.
   *   - queue is at batch size: standard batch-verification trigger.
   * Once cursor reaches preExistingBuilders.length, reuse is permanently
   * exhausted and batching becomes safe.
   */
  queueBuilderDeposit(pubkeyHex: PubkeyHex, deposit: electra.PendingDeposit): void {
    this.queuedBuilderDeposits.set(pubkeyHex, {
      pubkey: deposit.pubkey,
      withdrawalCredentials: deposit.withdrawalCredentials,
      amount: deposit.amount,
      signature: deposit.signature,
      slot: deposit.slot,
    });
    if (
      this.nextReuseIndexCheck < this.preExistingBuilders.length ||
      this.queuedBuilderDeposits.size >= BUILDER_DEPOSIT_BATCH_SIZE
    ) {
      this.onboardBuilders();
    }
  }

  /** Top up an already-onboarded builder's balance. No signature verification needed. */
  topupBuilder(builderIndex: BuilderIndex, amount: UintNum64): void {
    const builder = this.state.builders.get(builderIndex);
    builder.balance += amount;
    if (builderIndex < this.preExistingBuilders.length) {
      this.preExistingBuilders[builderIndex].balance += amount;
    }
  }

  /** Onboard queued builders if this pubkey is in the queue */
  onboardBuildersIfQueued(pubkeyHex: PubkeyHex): void {
    if (this.queuedBuilderDeposits.has(pubkeyHex)) {
      this.onboardBuilders();
    }
  }

  /** Batch-verify the queued deposits and apply the ones with valid signatures. */
  onboardBuilders(): void {
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
      const [_, deposit] = entries[j];
      this.addBuilderToRegistry(deposit.pubkey, deposit.withdrawalCredentials, deposit.amount, deposit.slot);
    }
    this.queuedBuilderDeposits.clear();
  }

  addBuilderToRegistry(pubkey: BLSPubkey, withdrawalCredentials: Bytes32, amount: UintNum64, slot: UintNum64): void {
    const currentEpoch = computeEpochAtSlot(this.state.slot);
    const depositEpoch = computeEpochAtSlot(slot);

    const newBuilder = buildNewBuilder(pubkey, withdrawalCredentials, amount, depositEpoch);

    // Try to find a reusable slot from an exited builder with zero balance
    for (let i = this.nextReuseIndexCheck; i < this.preExistingBuilders.length; i++) {
      const builder = this.preExistingBuilders[i];
      if (isBuilderExited(builder, currentEpoch)) {
        this.state.builders.set(i, newBuilder);
        this.preExistingBuilders[i] = newBuilder.toValue();
        this.builderIndexByPubkey.delete(toPubkeyHex(builder.pubkey));
        this.builderIndexByPubkey.set(toPubkeyHex(newBuilder.pubkey), i);
        this.nextReuseIndexCheck = i + 1;
        return;
      }
    }

    // don't have to scan again the next time
    this.nextReuseIndexCheck = this.preExistingBuilders.length;
    const newBuilderIndex = this.state.builders.length;
    this.state.builders.push(newBuilder);
    this.builderIndexByPubkey.set(toPubkeyHex(newBuilder.pubkey), newBuilderIndex);
  }
}

/** A builder slot is reusable when it is exited and fully withdrawn. */
function isBuilderExited(builder: gloas.Builder, currentEpoch: Epoch): boolean {
  return builder.withdrawableEpoch <= currentEpoch && builder.balance === 0;
}

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
      // Parse without group/infinity checks; deferred to the verify call below so
      // it can be batched across all sets.
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

  // Deposit pubkeys and signatures are untrusted, so group + infinity checks are
  // required. The trailing (true, true) args delegate those checks to blst, which
  // amortizes them across the whole batch.
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
    // Batch passed - every deposit with a well-formed pubkey and signature is valid
    for (const depositIndex of signatureSetDepositIndices) {
      results[depositIndex] = true;
    }
  } else {
    // Batch failed: at least one signature is invalid - verify each individually
    for (let s = 0; s < signatureSets.length; s++) {
      results[signatureSetDepositIndices[s]] = verify(
        signatureSets[s].msg,
        signatureSets[s].pk,
        signatureSets[s].sig,
        true,
        true
      );
    }
  }

  return results;
}
