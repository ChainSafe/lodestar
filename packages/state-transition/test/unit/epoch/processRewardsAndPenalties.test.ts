import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {beforeProcessEpoch} from "../../../src/cache/epochTransitionCache.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {processRewardsAndPenalties} from "../../../src/epoch/processRewardsAndPenalties.js";

describe("processRewardsAndPenalties", () => {
  it("preserves Gloas progressive balances tree", () => {
    const state = ssz.gloas.BeaconState.defaultViewDU();
    state.slot = SLOTS_PER_EPOCH * 2;

    const validatorCount = 8;
    state.validators = ssz.gloas.Validators.toViewDU(
      Array.from({length: validatorCount}, (_, i) => ({
        ...ssz.phase0.Validator.defaultValue(),
        pubkey: Buffer.alloc(48, i + 1),
        effectiveBalance: MAX_EFFECTIVE_BALANCE,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      }))
    );
    state.balances = ssz.gloas.Balances.toViewDU(Array.from({length: validatorCount}, () => MAX_EFFECTIVE_BALANCE));
    state.previousEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
      Array.from({length: validatorCount}, () => 0)
    );
    state.currentEpochParticipation = ssz.gloas.EpochParticipation.toViewDU(
      Array.from({length: validatorCount}, () => 0)
    );
    state.inactivityScores = ssz.gloas.InactivityScores.toViewDU(Array.from({length: validatorCount}, () => 0));

    const config = createBeaconConfig(
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
      }),
      state.genesisValidatorsRoot
    );
    const cachedState = createCachedBeaconState(
      state,
      {config, pubkeyCache},
      {skipSyncPubkeys: true, skipSyncCommitteeCache: true}
    );
    const cache = beforeProcessEpoch(cachedState);

    processRewardsAndPenalties(cachedState, cache);
    cachedState.commit();
    cachedState["clearCache"]();

    expect(cachedState.balances.get(0)).toBeGreaterThanOrEqual(0);
    expect(cachedState.balances.get(validatorCount - 1)).toBeGreaterThanOrEqual(0);
  });
});
