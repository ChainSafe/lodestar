import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {electra, ssz} from "@lodestar/types";
import {toPubkeyHex, toRootHex} from "@lodestar/utils";
import {applyDepositForBuilder} from "../../src/block/processDepositRequest.js";
import {onboardBuildersFromPendingDeposits} from "../../src/slot/upgradeStateToGloas.js";
import {createCachedBeaconStateTest} from "../../src/testUtils/state.js";
import {generateBuilderPendingDeposits} from "../../src/testUtils/util.js";
import {CachedBeaconStateGloas} from "../../src/types.js";
import {isBuilderWithdrawalCredential} from "../../src/util/gloas.js";
import {isValidatorKnown} from "../../src/util/index.js";
import {PendingDepositsLookup} from "../../src/util/pendingDepositsLookup.js";

/**
 * Verbatim copy of the original (pre-optimization) `onboardBuildersFromPendingDeposits`.
 * Kept as the reference oracle for the differential test below: the optimized version
 * must produce a byte-identical state. Reused unchanged to validate future improvements
 * (e.g. batch BLS signature verification).
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
    applyDepositForBuilder(
      state,
      deposit.pubkey,
      deposit.withdrawalCredentials,
      deposit.amount,
      deposit.signature,
      deposit.slot
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

  /**
   * A Gloas state (empty builders registry) whose pendingDeposits interleave every branch:
   * new builders, top-ups (incl. builder index 0), a non-builder deposit, an invalid signature.
   */
  function buildGloasStateWithPendingDeposits(): CachedBeaconStateGloas {
    const state = createCachedBeaconStateTest(ssz.gloas.BeaconState.defaultViewDU(), getConfig(ForkName.gloas), {
      skipSyncCommitteeCache: true,
      skipSyncPubkeys: true,
    });

    // 5 distinct, validly-signed builder deposits (interop indices 1000..1004)
    const builderDeposits = generateBuilderPendingDeposits(state.config, 5, 1000);

    // A deposit with a non-builder withdrawal credential - must stay in the pending queue
    const nonBuilderWc = Buffer.alloc(32);
    nonBuilderWc[0] = 0x01; // eth1 withdrawal prefix, not a builder
    const nonBuilderDeposit: electra.PendingDeposit = {
      pubkey: Buffer.alloc(48, 0xaa),
      withdrawalCredentials: nonBuilderWc,
      amount: 32_000_000_000,
      signature: Buffer.alloc(96),
      slot: 0,
    };

    // A builder deposit with an invalid signature - must be dropped (not onboarded, not queued)
    const invalidSigDeposit: electra.PendingDeposit = {...builderDeposits[4], signature: Buffer.alloc(96)};

    const deposits: electra.PendingDeposit[] = [
      builderDeposits[0], // new builder -> index 0
      builderDeposits[1], // new builder -> index 1
      nonBuilderDeposit, // stays in the pending queue
      builderDeposits[0], // top-up of builder index 0
      builderDeposits[2], // new builder -> index 2
      invalidSigDeposit, // dropped
      builderDeposits[2], // top-up of builder index 2
      builderDeposits[3], // new builder -> index 3
    ];

    const pendingDeposits = ssz.electra.PendingDeposits.defaultViewDU();
    for (const deposit of deposits) {
      pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
    }
    state.pendingDeposits = pendingDeposits;
    state.commit();

    return state;
  }

  it("optimized version produces the same state root as the naive reference", () => {
    const state = buildGloasStateWithPendingDeposits();
    const stateNaive = state.clone();
    const stateOptimized = state.clone();

    naiveOnboardBuildersFromPendingDeposits(stateNaive);
    onboardBuildersFromPendingDeposits(stateOptimized);

    expect(toRootHex(stateOptimized.hashTreeRoot())).toBe(toRootHex(stateNaive.hashTreeRoot()));
  });

  it("onboards new builders, applies top-ups, and keeps non-builder deposits queued", () => {
    const state = buildGloasStateWithPendingDeposits();
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
