import {beforeEach, describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {BUILDER_WITHDRAWAL_PREFIX, ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {promoteFinalizedPubkeys} from "../../../src/cache/pubkeyCache.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateGloas,
  createCachedBeaconState,
} from "../../../src/cache/stateCache.js";
import {processSlots} from "../../../src/stateTransition.js";
import {BeaconStateView} from "../../../src/stateView/beaconStateView.js";
import {getActivationChurnLimit, getActivationExitChurnLimit} from "../../../src/util/validator.js";
import {
  addDeposits,
  createFuluState,
  expectBranchIndices,
  finalizedValidatorCount,
  forkEpoch,
  genesisRoot,
  keyA,
  keyB,
  orderBranches,
  slashFirstValidator,
} from "../../utils/pubkeyCache.js";

const pubkeyA = keyA.toPublicKey().toBytes();
const pubkeyB = keyB.toPublicKey().toBytes();
const forkSlot = forkEpoch * SLOTS_PER_EPOCH;

describe("validator pubkey cache branches", () => {
  beforeEach(() => {
    pubkeyCache.reset();
    pubkeyCache.ensureCapacity(4096);
  });

  it.each(["side first", "canonical first"] as const)("keeps Gloas branch indices independent: %s", (order) => {
    const config = createBeaconConfig(getConfig(ForkName.gloas, forkEpoch), genesisRoot);
    const base = createCachedBeaconState(createFuluState(config, forkSlot - SLOTS_PER_EPOCH), {
      config,
      pubkeyCache,
    });
    addDeposits(base, config, getActivationExitChurnLimit(base.epochCtx), BUILDER_WITHDRAWAL_PREFIX);
    base.commit();

    const {side, canonical} = processBranches(base, order);
    expectBranchIndices(side, canonical, null, finalizedValidatorCount);
    expect((canonical as CachedBeaconStateGloas).builders.length).toBe(1);

    canonical.validators.get(finalizedValidatorCount).activationEligibilityEpoch = forkEpoch + 1;
    canonical.commit();
    promoteFinalizedPubkeys(pubkeyCache, new BeaconStateView(canonical), forkEpoch + 1);
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
        HEZE_FORK_EPOCH: forkEpoch,
        SLOT_DURATION_MS_HEZE: defaultChainConfig.SLOT_DURATION_MS,
        BLOB_SCHEDULE: [],
      }),
      genesisRoot
    );
    const genesis = createCachedBeaconState(createFuluState(config, 0), {config, pubkeyCache});
    const base = processSlots(genesis, forkSlot - SLOTS_PER_EPOCH) as CachedBeaconStateGloas;
    addDeposits(base, config, getActivationChurnLimit(base.epochCtx), 0x00);
    base.commit();

    const {side, canonical} = processBranches(base, "side first");
    expectBranchIndices(side, canonical, null, finalizedValidatorCount);
  });

  it("keeps the same indices on both branches without a fork", () => {
    const config = createBeaconConfig(getConfig(ForkName.fulu), genesisRoot);
    const base = createCachedBeaconState(createFuluState(config, forkSlot - SLOTS_PER_EPOCH), {
      config,
      pubkeyCache,
    });
    addDeposits(base, config, getActivationExitChurnLimit(base.epochCtx), BUILDER_WITHDRAWAL_PREFIX);
    base.commit();

    const {side, canonical} = processBranches(base, "side first");
    expectBranchIndices(side, canonical, finalizedValidatorCount, finalizedValidatorCount + 1);
  });
});

function processBranches(base: CachedBeaconStateAllForks, order: "side first" | "canonical first") {
  const processSide = (): CachedBeaconStateAllForks => {
    const side = base.clone();
    slashFirstValidator(side);
    side.commit();
    return processSlots(side, forkSlot);
  };
  const processCanonical = (): CachedBeaconStateAllForks => processSlots(base, forkSlot + SLOTS_PER_EPOCH);
  return orderBranches(order, processSide, processCanonical);
}
