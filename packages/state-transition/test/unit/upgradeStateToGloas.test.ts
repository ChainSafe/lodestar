import {describe, expect, it} from "vitest";
import {byteArrayEquals} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName} from "@lodestar/params";
import {BLSPubkey, BuilderIndex, Bytes32, Epoch, UintNum64, electra, ssz} from "@lodestar/types";
import {toPubkeyHex, toRootHex} from "@lodestar/utils";
import {isValidDepositSignature} from "../../src/block/processDeposit.js";
import {onboardBuildersFromPendingDeposits} from "../../src/slot/upgradeStateToGloas.js";
import {createCachedBeaconStateTest} from "../../src/testUtils/state.js";
import {generateBuilderPendingDeposits} from "../../src/testUtils/util.js";
import {CachedBeaconStateGloas} from "../../src/types.js";
import {isBuilderWithdrawalCredential} from "../../src/util/gloas.js";
import {computeEpochAtSlot, isValidatorKnown} from "../../src/util/index.js";
import {PendingDepositsLookup} from "../../src/util/pendingDepositsLookup.js";

// ---------------------------------------------------------------------------
// Naive oracle helpers — verbatim copies of the eager pre-Gloas-batching logic
// previously living in src/block/processDepositRequest.ts. Kept inline here so
// the production module no longer carries dead code; this file owns the oracle
// it differentially compares against.
// ---------------------------------------------------------------------------

function naiveFindBuilderIndexByPubkey(state: CachedBeaconStateGloas, pubkey: Uint8Array): BuilderIndex | null {
  for (let i = 0; i < state.builders.length; i++) {
    if (byteArrayEquals(state.builders.getReadonly(i).pubkey, pubkey)) {
      return i;
    }
  }
  return null;
}

function naiveBuildNewBuilder(
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  depositEpoch: Epoch
) {
  return ssz.gloas.Builder.toViewDU({
    pubkey,
    version: withdrawalCredentials[0],
    executionAddress: withdrawalCredentials.subarray(12),
    balance: amount,
    depositEpoch,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
  });
}

function naiveAddBuilderToRegistry(
  state: CachedBeaconStateGloas,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  slot: UintNum64
): void {
  const currentEpoch = computeEpochAtSlot(state.slot);
  const depositEpoch = computeEpochAtSlot(slot);
  const newBuilder = naiveBuildNewBuilder(pubkey, withdrawalCredentials, amount, depositEpoch);

  // Try to find a reusable slot from an exited builder with zero balance
  for (let i = 0; i < state.builders.length; i++) {
    const builder = state.builders.getReadonly(i);
    if (builder.withdrawableEpoch <= currentEpoch && builder.balance === 0) {
      state.builders.set(i, newBuilder);
      return;
    }
  }
  state.builders.push(newBuilder);
}

function naiveApplyDepositForBuilder(
  state: CachedBeaconStateGloas,
  pubkey: BLSPubkey,
  withdrawalCredentials: Bytes32,
  amount: UintNum64,
  signature: Bytes32 | null,
  slot: UintNum64,
  builderIndex: BuilderIndex | null
): void {
  if (builderIndex !== null) {
    state.builders.get(builderIndex).balance += amount;
    return;
  }
  const validSignature =
    signature !== null ? isValidDepositSignature(state.config, pubkey, withdrawalCredentials, amount, signature) : true;
  if (validSignature) {
    naiveAddBuilderToRegistry(state, pubkey, withdrawalCredentials, amount, slot);
  }
}

/**
 * Verbatim copy of the eager `onboardBuildersFromPendingDeposits` (pre batch-verification).
 * The reference oracle for the differential tests below: the optimized (lazy + batched)
 * version must produce a byte-identical state. Reused unchanged to validate future changes.
 */
function naiveOnboardBuildersFromPendingDeposits(state: CachedBeaconStateGloas): void {
  // Track pubkeys of new builders added when applying deposits
  const builderPubkeys = new Set<string>();

  const pendingDeposits = ssz.electra.PendingDeposits.defaultViewDU();
  const pendingDepositsLookup = PendingDepositsLookup.buildEmpty();

  for (let i = 0; i < state.pendingDeposits.length; i++) {
    const deposit = state.pendingDeposits.getReadonly(i);

    const validatorIndex = state.epochCtx.getValidatorIndex(deposit.pubkey);
    const pubkeyHex = toPubkeyHex(deposit.pubkey);

    // Deposits for existing validators stay in the pending queue
    if (isValidatorKnown(state, validatorIndex)) {
      pendingDeposits.push(deposit);
      pendingDepositsLookup.add(deposit, pubkeyHex);
      continue;
    }

    if (!builderPubkeys.has(pubkeyHex)) {
      if (!isBuilderWithdrawalCredential(deposit.withdrawalCredentials)) {
        pendingDeposits.push(deposit);
        pendingDepositsLookup.add(deposit, pubkeyHex);
        continue;
      }
      if (pendingDepositsLookup.hasPendingValidator(state.config, pubkeyHex)) {
        pendingDeposits.push(deposit);
        pendingDepositsLookup.add(deposit, pubkeyHex);
        continue;
      }
    }

    const buildersLenBefore = state.builders.length;
    const builderIndex = naiveFindBuilderIndexByPubkey(state, deposit.pubkey);
    naiveApplyDepositForBuilder(
      state,
      deposit.pubkey,
      deposit.withdrawalCredentials,
      deposit.amount,
      deposit.signature,
      deposit.slot,
      builderIndex
    );
    if (state.builders.length > buildersLenBefore) {
      builderPubkeys.add(pubkeyHex);
    }
  }

  state.pendingDeposits = pendingDeposits;
}

describe("onboardBuildersFromPendingDeposits", () => {
  /** 1 ETH in Gwei - the amount used by `generateBuilderPendingDeposits` */
  const builderAmount = 1_000_000_000;

  const chainConfig = getConfig(ForkName.gloas);
  // BeaconConfig used to sign the builder deposit pool. Deposit signatures use a
  // fork-agnostic domain, so only GENESIS_FORK_VERSION matters and it matches the config
  // of every state built by `buildGloasState`.
  const beaconConfig = createBeaconConfig(chainConfig, Buffer.alloc(32));
  // Pool of 100 distinct, validly-signed builder deposits (interop indices 1000..1099)
  const pool = generateBuilderPendingDeposits(beaconConfig, 100, 1000);

  /** A deposit with the same pubkey but an all-zero (invalid) signature. */
  function withInvalidSignature(deposit: electra.PendingDeposit): electra.PendingDeposit {
    return {...deposit, signature: Buffer.alloc(96)};
  }

  /** A deposit with a deliberately malformed (non-curve-point) pubkey. */
  function withMalformedPubkey(deposit: electra.PendingDeposit): electra.PendingDeposit {
    return {...deposit, pubkey: Buffer.alloc(48, 0xff)};
  }

  /** A deposit with the same pubkey but a non-builder (0x01) withdrawal credential. */
  function withNonBuilderCredentials(deposit: electra.PendingDeposit): electra.PendingDeposit {
    const withdrawalCredentials = Buffer.alloc(32);
    withdrawalCredentials[0] = 0x01;
    return {...deposit, withdrawalCredentials};
  }

  /** A non-builder deposit with a distinct pubkey; always passed through to pendingDeposits. */
  function nonBuilderDeposit(seed: number): electra.PendingDeposit {
    const withdrawalCredentials = Buffer.alloc(32);
    withdrawalCredentials[0] = 0x01;
    const pubkey = Buffer.alloc(48, 0xee);
    pubkey.writeUInt32BE(seed >>> 0, 0);
    return {pubkey, withdrawalCredentials, amount: 32_000_000_000, signature: Buffer.alloc(96), slot: 0};
  }

  function buildGloasState(deposits: electra.PendingDeposit[]): CachedBeaconStateGloas {
    const state = createCachedBeaconStateTest(ssz.gloas.BeaconState.defaultViewDU(), chainConfig, {
      skipSyncCommitteeCache: true,
      skipSyncPubkeys: true,
    });
    const pendingDeposits = ssz.electra.PendingDeposits.defaultViewDU();
    for (const deposit of deposits) {
      pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
    }
    state.pendingDeposits = pendingDeposits;
    state.commit();
    return state;
  }

  /** Run the naive and the optimized onboarding on identical states; assert they match. */
  function runDifferential(deposits: electra.PendingDeposit[]): void {
    const state = buildGloasState(deposits);
    const naive = state.clone();
    const optimized = state.clone();

    naiveOnboardBuildersFromPendingDeposits(naive);
    onboardBuildersFromPendingDeposits(optimized);

    // builders registry must match the naive version
    expect(optimized.builders.toValue()).toEqual(naive.builders.toValue());
    // pendingDeposits must match the naive version
    expect(optimized.pendingDeposits.toValue()).toEqual(naive.pendingDeposits.toValue());
    // full state root catches anything else
    expect(toRootHex(optimized.hashTreeRoot())).toBe(toRootHex(naive.hashTreeRoot()));
  }

  // The 8-deposit mix reused by the differential table and the concrete-value test below
  const mixedDeposits: electra.PendingDeposit[] = [
    pool[0], // new builder -> index 0
    pool[1], // new builder -> index 1
    nonBuilderDeposit(1), // stays in pendingDeposits
    pool[0], // top-up of builder 0
    pool[2], // new builder -> index 2
    withInvalidSignature(pool[3]), // dropped
    pool[2], // top-up of builder 2
    pool[4], // new builder -> index 3
  ];

  const scenarios: {name: string; deposits: electra.PendingDeposit[]}[] = [
    {name: "empty pendingDeposits", deposits: []},
    {name: "only non-builder deposits", deposits: [nonBuilderDeposit(1), nonBuilderDeposit(2), nonBuilderDeposit(3)]},
    {name: "single valid builder", deposits: [pool[0]]},
    {name: "single invalid-signature builder", deposits: [withInvalidSignature(pool[0])]},
    {name: "five valid builders flushed at end of loop", deposits: pool.slice(0, 5)},
    {
      name: "batch with one invalid signature",
      deposits: [pool[0], pool[1], withInvalidSignature(pool[2]), pool[3], pool[4]],
    },
    {name: "batch with all invalid signatures", deposits: pool.slice(0, 5).map(withInvalidSignature)},
    {
      name: "batch with a malformed pubkey",
      deposits: [pool[0], pool[1], withMalformedPubkey(pool[2]), pool[3], pool[4]],
    },
    {name: "exactly 32 builders (one full batch)", deposits: pool.slice(0, 32)},
    {name: "33 builders (full batch + remainder)", deposits: pool.slice(0, 33)},
    {name: "70 builders (multiple batches)", deposits: pool.slice(0, 70)},
    {
      // The first 32-batch passes; the second batch (8) falls back to one-by-one
      name: "invalid signature in the second batch",
      deposits: [...pool.slice(0, 35), withInvalidSignature(pool[35]), ...pool.slice(36, 40)],
    },
    {
      // Two full 32-batches verified independently: the first all-valid, the second all-invalid
      name: "a fully valid batch followed by a fully invalid batch",
      deposits: [...pool.slice(0, 32), ...pool.slice(32, 64).map(withInvalidSignature)],
    },
    {
      name: "builders interleaved with non-builder deposits",
      deposits: [pool[0], nonBuilderDeposit(1), pool[1], nonBuilderDeposit(2), pool[2], nonBuilderDeposit(3)],
    },
    {name: "top-up of builder index 0 after a flush", deposits: [...pool.slice(0, 32), pool[0]]},
    {name: "force-flush: queued pubkey reappears (valid)", deposits: [pool[0], pool[1], pool[0]]},
    {
      name: "force-flush: queued pubkey reappears after invalid signature",
      deposits: [withInvalidSignature(pool[0]), pool[1], pool[0]],
    },
    {
      name: "force-flush: queued pubkey reappears with non-builder credentials",
      deposits: [pool[0], withNonBuilderCredentials(pool[0])],
    },
    {
      name: "force-flush: invalid queued pubkey reappears with non-builder credentials",
      deposits: [withInvalidSignature(pool[0]), withNonBuilderCredentials(pool[0])],
    },
    {name: "same pubkey three times", deposits: [pool[0], pool[0], pool[0]]},
    {
      name: "top-up applied while builders are queued",
      deposits: [...pool.slice(0, 32), pool[32], pool[33], pool[0], pool[34]],
    },
    {name: "mixed: builders, top-ups, non-builder, invalid", deposits: mixedDeposits},
  ];

  for (const {name, deposits} of scenarios) {
    it(`optimized matches naive: ${name}`, () => {
      runDifferential(deposits);
    });
  }

  it("onboards new builders, applies top-ups, and keeps non-builder deposits queued", () => {
    const state = buildGloasState(mixedDeposits);
    onboardBuildersFromPendingDeposits(state);
    state.commit();

    // 4 new builders onboarded; the invalid-signature deposit is dropped
    expect(state.builders.length).toBe(4);
    // builders 0 and 2 were topped up once each
    expect(state.builders.get(0).balance).toBe(2 * builderAmount);
    expect(state.builders.get(2).balance).toBe(2 * builderAmount);
    // builders 1 and 3 received a single deposit
    expect(state.builders.get(1).balance).toBe(builderAmount);
    expect(state.builders.get(3).balance).toBe(builderAmount);
    // only the non-builder deposit remains in the queue
    expect(state.pendingDeposits.length).toBe(1);
  });
});
