import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {aggregateSignatures} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {BUILDER_WITHDRAWAL_PREFIX, ForkName, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
import {getValidatorIndex, promoteFinalizedPubkeys} from "../../../src/cache/pubkeyCache.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateGloas,
  createCachedBeaconState,
} from "../../../src/cache/stateCache.js";
import {processSlots} from "../../../src/stateTransition.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {interopSecretKey} from "../../../src/util/interop.js";
import {SignatureSetType, verifySignatureSet} from "../../../src/util/signatureSets.js";
import {getActivationChurnLimit, getActivationExitChurnLimit} from "../../../src/util/validator.js";
import {
  addPubkeyCacheDeposits,
  createPubkeyCacheFuluState,
  finalizedValidatorCount,
  pubkeyCacheForkEpoch,
  pubkeyCacheGenesisRoot,
  pubkeyCacheKeyA,
  pubkeyCacheKeyB,
  slashPubkeyCacheFirstValidator,
} from "../../utils/pubkeyCache.js";

const pubkeyA = pubkeyCacheKeyA.toPublicKey().toBytes();
const pubkeyB = pubkeyCacheKeyB.toPublicKey().toBytes();
const forkSlot = pubkeyCacheForkEpoch * SLOTS_PER_EPOCH;

describe("validator pubkey cache branches", () => {
  beforeEach(() => {
    pubkeyCache.reset();
    pubkeyCache.ensureCapacity(4096);
  });

  it.each(["side first", "canonical first"] as const)("keeps Gloas branch indices independent: %s", (order) => {
    const config = createBeaconConfig(getConfig(ForkName.gloas, pubkeyCacheForkEpoch), pubkeyCacheGenesisRoot);
    const base = createCachedBeaconState(createPubkeyCacheFuluState(config, forkSlot - SLOTS_PER_EPOCH), {
      config,
      pubkeyCache,
    });
    addPubkeyCacheDeposits(base, config, getActivationExitChurnLimit(base.epochCtx), BUILDER_WITHDRAWAL_PREFIX);
    base.commit();

    const {side, canonical} = processBranches(base, order);
    expectBranchIndices(side, canonical, null, finalizedValidatorCount);
    expect((canonical as CachedBeaconStateGloas).builders.length).toBe(1);

    canonical.validators.get(finalizedValidatorCount).activationEligibilityEpoch = pubkeyCacheForkEpoch + 1;
    canonical.commit();
    promoteFinalizedPubkeys(pubkeyCache, new BeaconStateView(canonical), pubkeyCacheForkEpoch + 1);
    expect(pubkeyCache.size).toBe(finalizedValidatorCount + 1);
    expect(pubkeyCache.getIndex(pubkeyB)).toBe(finalizedValidatorCount);
    expect(pubkeyCache.getIndex(pubkeyA)).toBeNull();
    expect(pubkeyCache.getPubkeyBytes(finalizedValidatorCount)).toEqual(pubkeyB);
  });

  it("keeps Heze branch indices independent when legacy credentials are skipped", () => {
    const config = createBeaconConfig(
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 1,
        HEZE_FORK_EPOCH: pubkeyCacheForkEpoch,
        SLOT_DURATION_MS_HEZE: defaultChainConfig.SLOT_DURATION_MS,
        BLOB_SCHEDULE: [],
      }),
      pubkeyCacheGenesisRoot
    );
    const genesis = createCachedBeaconState(createPubkeyCacheFuluState(config, 0), {config, pubkeyCache});
    const base = processSlots(genesis, forkSlot - SLOTS_PER_EPOCH) as CachedBeaconStateGloas;
    addPubkeyCacheDeposits(base, config, getActivationChurnLimit(base.epochCtx), 0x00);
    base.commit();

    const {side, canonical} = processBranches(base, "side first");
    expectBranchIndices(side, canonical, null, finalizedValidatorCount);
  });

  it("keeps the same indices on both branches without a fork", () => {
    const config = createBeaconConfig(getConfig(ForkName.fulu), pubkeyCacheGenesisRoot);
    const base = createCachedBeaconState(createPubkeyCacheFuluState(config, forkSlot - SLOTS_PER_EPOCH), {
      config,
      pubkeyCache,
    });
    addPubkeyCacheDeposits(base, config, getActivationExitChurnLimit(base.epochCtx), BUILDER_WITHDRAWAL_PREFIX);
    base.commit();

    const {side, canonical} = processBranches(base, "side first");
    expectBranchIndices(side, canonical, finalizedValidatorCount, finalizedValidatorCount + 1);
  });

  it("rebuilds sync committees and verifies active validators beyond the finalized cache", () => {
    const config = createBeaconConfig(getConfig(ForkName.fulu), pubkeyCacheGenesisRoot);
    const view = createPubkeyCacheFuluState(config, 0);
    pubkeyCache.syncPubkeys(view.validators.getAllReadonlyValues());
    pubkeyCache.truncate(1);
    const state = createCachedBeaconState(view, {config, pubkeyCache}, {skipSyncPubkeys: true});
    expect([...state.epochCtx.currentSyncCommitteeIndexed.validatorIndices]).toEqual(
      Array.from({length: SYNC_COMMITTEE_SIZE}, (_, i) => i % finalizedValidatorCount)
    );

    const signingRoot = Buffer.alloc(32, 7);
    const index = finalizedValidatorCount - 1;
    expect(
      verifySignatureSet(
        {
          type: SignatureSetType.indexed,
          index,
          signingRoot,
          signature: interopSecretKey(index).sign(signingRoot).toBytes(),
        },
        state
      )
    ).toBe(true);
    expect(
      verifySignatureSet(
        {
          type: SignatureSetType.aggregate,
          indices: [0, index],
          signingRoot,
          signature: aggregateSignatures([0, index].map((i) => interopSecretKey(i).sign(signingRoot))).toBytes(),
        },
        new BeaconStateView(state)
      )
    ).toBe(true);
    expect(pubkeyCache.size).toBe(1);
  });
});

function processBranches(base: CachedBeaconStateAllForks, order: "side first" | "canonical first") {
  const processSide = (): CachedBeaconStateAllForks => {
    const side = base.clone();
    slashPubkeyCacheFirstValidator(side);
    side.commit();
    return processSlots(side, forkSlot);
  };
  const processCanonical = (): CachedBeaconStateAllForks => processSlots(base, forkSlot + SLOTS_PER_EPOCH);
  return order === "side first"
    ? {side: processSide(), canonical: processCanonical()}
    : {canonical: processCanonical(), side: processSide()};
}

function expectBranchIndices(
  side: CachedBeaconStateAllForks,
  canonical: CachedBeaconStateAllForks,
  canonicalA: number | null,
  canonicalB: number
): void {
  expect(side.validators.length).toBe(finalizedValidatorCount + 2);
  expect(getValidatorIndex(side, pubkeyA, pubkeyCache)).toBe(finalizedValidatorCount);
  expect(getValidatorIndex(side, pubkeyB, pubkeyCache)).toBe(finalizedValidatorCount + 1);
  expect(getValidatorIndex(canonical, pubkeyA, pubkeyCache)).toBe(canonicalA);
  expect(getValidatorIndex(canonical, pubkeyB, pubkeyCache)).toBe(canonicalB);
  expect(canonical.validators.getReadonly(canonicalB).pubkey).toEqual(pubkeyB);
  expect(pubkeyCache.size).toBe(finalizedValidatorCount);
  expect(pubkeyCache.getIndex(pubkeyA)).toBeNull();
  expect(pubkeyCache.getIndex(pubkeyB)).toBeNull();
}
