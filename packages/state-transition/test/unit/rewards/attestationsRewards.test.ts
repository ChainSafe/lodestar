import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE,
  PARTICIPATION_FLAG_WEIGHTS,
  SLOTS_PER_EPOCH,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {beforeProcessEpoch} from "../../../src/cache/epochTransitionCache.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {getRewardsAndPenaltiesAltair} from "../../../src/epoch/getRewardsAndPenalties.js";
import {computeAttestationsRewards} from "../../../src/rewards/attestationsRewards.js";
import {CachedBeaconStateAltair} from "../../../src/types.js";
import {interopSecretKey} from "../../../src/util/interop.js";

const validatorCount = 16;
const TIMELY_ALL_FLAGS = 0b111;

function createAltairState(): CachedBeaconStateAltair {
  const {BeaconState} = ssz.altair;
  const state = BeaconState.defaultViewDU();
  state.slot = SLOTS_PER_EPOCH * 3;

  const pubkeys = Array.from({length: validatorCount}, (_, i) => interopSecretKey(i).toPublicKey().toBytes());
  state.validators = BeaconState.fields.validators.toViewDU(
    pubkeys.map((pubkey) => ({
      ...ssz.phase0.Validator.defaultValue(),
      pubkey,
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    }))
  );
  state.balances = BeaconState.fields.balances.toViewDU(pubkeys.map(() => MAX_EFFECTIVE_BALANCE));
  // Half the validators miss every flag so both the reward and penalty paths are exercised
  state.previousEpochParticipation = BeaconState.fields.previousEpochParticipation.toViewDU(
    pubkeys.map((_, i) => (i % 2 === 0 ? TIMELY_ALL_FLAGS : 0))
  );
  state.currentEpochParticipation = BeaconState.fields.currentEpochParticipation.toViewDU(pubkeys.map(() => 0));
  state.inactivityScores = BeaconState.fields.inactivityScores.toViewDU(pubkeys.map(() => 0));

  const config = createBeaconConfig(createChainForkConfig({ALTAIR_FORK_EPOCH: 0}), state.genesisValidatorsRoot);
  return createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncCommitteeCache: true});
}

describe("computeAttestationsRewards", () => {
  it("floors ideal rewards and penalties like the state transition", async () => {
    const state = createAltairState();
    const cache = beforeProcessEpoch(state);
    const {idealRewards, totalRewards} = await computeAttestationsRewards(
      state.config,
      state.epochCtx.pubkeyCache,
      state,
      []
    );

    const baseRewardPerIncrement = BigInt(cache.baseRewardPerIncrement);
    const activeIncrements = BigInt(cache.totalActiveStakeByIncrement);
    const {sourceStakeByIncrement, targetStakeByIncrement, headStakeByIncrement} = cache.prevEpochUnslashedStake;
    const idealReward = (increments: number, flagIndex: number, unslashedIncrements: number): number => {
      const baseReward = BigInt(increments) * baseRewardPerIncrement;
      const weight = BigInt(PARTICIPATION_FLAG_WEIGHTS[flagIndex]);
      return Number(
        (baseReward * weight * BigInt(unslashedIncrements)) / (activeIncrements * BigInt(WEIGHT_DENOMINATOR))
      );
    };

    let roundingDifferences = 0;
    for (const reward of idealRewards) {
      const increments = reward.effectiveBalance / EFFECTIVE_BALANCE_INCREMENT;
      const expected = {
        source: idealReward(increments, TIMELY_SOURCE_FLAG_INDEX, sourceStakeByIncrement),
        target: idealReward(increments, TIMELY_TARGET_FLAG_INDEX, targetStakeByIncrement),
        head: idealReward(increments, TIMELY_HEAD_FLAG_INDEX, headStakeByIncrement),
      };
      expect({source: reward.source, target: reward.target, head: reward.head}).toEqual(expected);
      const baseReward = increments * cache.baseRewardPerIncrement;
      const unflooredSource =
        (baseReward * PARTICIPATION_FLAG_WEIGHTS[TIMELY_SOURCE_FLAG_INDEX] * sourceStakeByIncrement) /
        (cache.totalActiveStakeByIncrement * WEIGHT_DENOMINATOR);
      if (Math.round(unflooredSource) !== expected.source) roundingDifferences++;
    }
    // Guard that this fixture actually distinguishes floor from round
    expect(roundingDifferences).toBeGreaterThan(0);

    const [rewards, penalties] = getRewardsAndPenaltiesAltair(state, cache);
    expect(totalRewards).toHaveLength(validatorCount);
    for (const reward of totalRewards) {
      const i = reward.validatorIndex;
      expect(reward.head + reward.target + reward.source + reward.inactivity).toBe(rewards[i] - penalties[i]);
    }
  });
});
