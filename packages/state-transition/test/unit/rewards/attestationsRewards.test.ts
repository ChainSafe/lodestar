import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {BitArray} from "@chainsafe/ssz";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkName,
  ForkPostAltair,
  ForkSeq,
  MAX_EFFECTIVE_BALANCE,
  PARTICIPATION_FLAG_WEIGHTS,
  TIMELY_HEAD_FLAG_INDEX,
  TIMELY_SOURCE_FLAG_INDEX,
  TIMELY_TARGET_FLAG_INDEX,
  WEIGHT_DENOMINATOR,
  forkPostAltair,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {beforeProcessEpoch} from "../../../src/cache/epochTransitionCache.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {computeAttestationsRewards} from "../../../src/rewards/attestationsRewards.js";
import {processSlots} from "../../../src/stateTransition.js";
import {CachedBeaconStateAllForks} from "../../../src/types.js";
import {computeEndSlotAtEpoch} from "../../../src/util/epoch.js";
import {interopSecretKey} from "../../../src/util/interop.js";

const validatorCount = 16;
const TIMELY_ALL_FLAGS = 0b111;

type StateOpts = {
  fork: ForkPostAltair;
  /** Epoch whose end slot the state is at, the transition out of it pays the previous epoch */
  epoch: number;
  /** Validators with index below this count attest with all flags, the rest miss every flag */
  attesterCount: number;
  inactivityScore: number;
  /** Justify previous epochs so that the transition finalizes and ends an ongoing leak */
  finalizeOnTransition?: boolean;
};

function createState({fork, epoch, attesterCount, inactivityScore, finalizeOnTransition}: StateOpts) {
  const {BeaconState} = ssz[fork];
  const state = BeaconState.defaultViewDU();
  state.slot = computeEndSlotAtEpoch(epoch);

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
  state.previousEpochParticipation = BeaconState.fields.previousEpochParticipation.toViewDU(
    pubkeys.map((_, i) => (i < attesterCount ? TIMELY_ALL_FLAGS : 0))
  );
  state.currentEpochParticipation = BeaconState.fields.currentEpochParticipation.toViewDU(pubkeys.map(() => 0));
  state.inactivityScores = BeaconState.fields.inactivityScores.toViewDU(pubkeys.map(() => inactivityScore));

  if (finalizeOnTransition) {
    const root = Buffer.alloc(32, 1);
    state.previousJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: epoch - 2, root});
    state.currentJustifiedCheckpoint = ssz.phase0.Checkpoint.toViewDU({epoch: epoch - 1, root});
    state.justificationBits = ssz.phase0.JustificationBits.toViewDU(BitArray.fromBoolArray([true, true, false, false]));
  }
  state.commit();

  const forkEpochs: Record<string, number> = {};
  for (const name of forkPostAltair) {
    forkEpochs[`${name.toUpperCase()}_FORK_EPOCH`] = ForkSeq[name] <= ForkSeq[fork] ? 0 : Infinity;
  }
  const config = createBeaconConfig(createChainForkConfig(forkEpochs), state.genesisValidatorsRoot);
  return createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncCommitteeCache: true});
}

describe("computeAttestationsRewards", () => {
  it("floors ideal rewards and penalties like the state transition", async () => {
    const state = createState({fork: ForkName.altair, epoch: 3, attesterCount: 8, inactivityScore: 0});
    const cache = beforeProcessEpoch(state);
    const {idealRewards} = await computeAttestationsRewards(state.config, state.epochCtx.pubkeyCache, state, []);

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
  });

  describe("matches the balance delta of the epoch transition", () => {
    const testCases: ({id: string} & StateOpts)[] = [
      {id: "altair, no leak", fork: ForkName.altair, epoch: 3, attesterCount: 8, inactivityScore: 0},
      {id: "bellatrix, no leak", fork: ForkName.bellatrix, epoch: 3, attesterCount: 8, inactivityScore: 0},
      {
        id: "bellatrix, no leak, recovering scores",
        fork: ForkName.bellatrix,
        epoch: 3,
        attesterCount: 8,
        inactivityScore: 20,
      },
      {id: "bellatrix, leak", fork: ForkName.bellatrix, epoch: 8, attesterCount: 8, inactivityScore: 0},
      {
        id: "bellatrix, leak, nonzero scores",
        fork: ForkName.bellatrix,
        epoch: 8,
        attesterCount: 8,
        inactivityScore: 40,
      },
      {
        id: "bellatrix, leak ends on this transition",
        fork: ForkName.bellatrix,
        epoch: 8,
        attesterCount: 12,
        inactivityScore: 40,
        finalizeOnTransition: true,
      },
      {id: "electra, leak, nonzero scores", fork: ForkName.electra, epoch: 8, attesterCount: 8, inactivityScore: 40},
    ];

    for (const {id, ...opts} of testCases) {
      it(id, async () => {
        const state = createState(opts);
        const {totalRewards} = await computeAttestationsRewards(state.config, state.epochCtx.pubkeyCache, state, []);
        expect(totalRewards).toHaveLength(validatorCount);

        const preBalances = state.balances.getAll();
        const postState = processSlots(state.clone() as CachedBeaconStateAllForks, state.slot + 1);
        const postBalances = postState.balances.getAll();

        for (const reward of totalRewards) {
          const i = reward.validatorIndex;
          const total = reward.head + reward.target + reward.source + reward.inactivity;
          expect(total, `wrong total reward for validator ${i}`).toBe(postBalances[i] - preBalances[i]);
        }
      });
    }

    it("charges the inactivity penalty on the updated inactivity score", async () => {
      const state = createState({fork: ForkName.bellatrix, epoch: 8, attesterCount: 8, inactivityScore: 0});
      const {totalRewards} = await computeAttestationsRewards(state.config, state.epochCtx.pubkeyCache, state, []);
      const missed = totalRewards.filter((r) => r.validatorIndex >= 8);
      expect(missed).toHaveLength(8);
      for (const reward of missed) {
        expect(reward.inactivity, `expected inactivity penalty for validator ${reward.validatorIndex}`).toBeLessThan(0);
      }
    });

    it("pays attestation rewards when the transition ends the leak", async () => {
      const state = createState({
        fork: ForkName.bellatrix,
        epoch: 8,
        attesterCount: 12,
        inactivityScore: 40,
        finalizeOnTransition: true,
      });
      const {idealRewards} = await computeAttestationsRewards(state.config, state.epochCtx.pubkeyCache, state, []);
      const fullBalance = idealRewards.find((r) => r.effectiveBalance === MAX_EFFECTIVE_BALANCE);
      expect(fullBalance?.target).toBeGreaterThan(0);
    });
  });
});
