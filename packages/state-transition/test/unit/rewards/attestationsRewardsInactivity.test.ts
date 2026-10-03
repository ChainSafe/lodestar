import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {
  FAR_FUTURE_EPOCH,
  ForkName,
  INACTIVITY_PENALTY_QUOTIENT_ALTAIR,
  INACTIVITY_PENALTY_QUOTIENT_BELLATRIX,
  MAX_EFFECTIVE_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {computeAttestationsRewards} from "../../../src/rewards/attestationsRewards.js";
import {CachedBeaconStateAllForks} from "../../../src/types.js";
import {interopSecretKey} from "../../../src/util/interop.js";

const validatorCount = 16;
const TIMELY_ALL_FLAGS = 0b111;
const inactivityScoreStep = 1000;

function createState(fork: ForkName.altair | ForkName.bellatrix): CachedBeaconStateAllForks {
  const {BeaconState} = ssz[fork];
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
  // Odd validators miss the target vote and incur an inactivity penalty
  state.previousEpochParticipation = BeaconState.fields.previousEpochParticipation.toViewDU(
    pubkeys.map((_, i) => (i % 2 === 0 ? TIMELY_ALL_FLAGS : 0))
  );
  state.currentEpochParticipation = BeaconState.fields.currentEpochParticipation.toViewDU(pubkeys.map(() => 0));
  state.inactivityScores = BeaconState.fields.inactivityScores.toViewDU(pubkeys.map((_, i) => i * inactivityScoreStep));

  const config = createBeaconConfig(
    createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: fork === ForkName.bellatrix ? 0 : Infinity,
    }),
    state.genesisValidatorsRoot
  );
  return createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncCommitteeCache: true});
}

describe("computeAttestationsRewards inactivity penalty", () => {
  const testCases = [
    {fork: ForkName.altair, quotient: INACTIVITY_PENALTY_QUOTIENT_ALTAIR},
    {fork: ForkName.bellatrix, quotient: INACTIVITY_PENALTY_QUOTIENT_BELLATRIX},
  ] as const;

  for (const {fork, quotient} of testCases) {
    it(`uses the ${fork} inactivity penalty quotient`, async () => {
      const state = createState(fork);
      const {totalRewards} = await computeAttestationsRewards(state.config, state.epochCtx.pubkeyCache, state, []);

      expect(totalRewards).toHaveLength(validatorCount);
      const denominator = BigInt(state.config.INACTIVITY_SCORE_BIAS) * BigInt(quotient);
      for (const reward of totalRewards) {
        const i = reward.validatorIndex;
        const missedTarget = i % 2 === 1;
        const expected = missedTarget
          ? -Number((BigInt(MAX_EFFECTIVE_BALANCE) * BigInt(i * inactivityScoreStep)) / denominator)
          : 0;
        expect(reward.inactivity).toBe(expected);
      }
    });
  }
});
