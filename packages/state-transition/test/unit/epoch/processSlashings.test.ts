import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {EFFECTIVE_BALANCE_INCREMENT, EPOCHS_PER_SLASHINGS_VECTOR, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {beforeProcessEpoch} from "../../../src/cache/epochTransitionCache.js";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {processSlashings} from "../../../src/epoch/processSlashings.js";

describe("processSlashings", () => {
  it("computes Electra penalty per increment with exact integer division", () => {
    // 3 * 3_344_664 * EFFECTIVE_BALANCE_INCREMENT / 37_379_287 is 1 / 37_379_287 below 268_437_223
    const totalActiveIncrements = 37_379_287;
    const totalSlashedIncrements = 3_344_664;
    const effectiveBalanceIncrements = 280;
    const currentEpoch = 1;

    const stateValue = ssz.electra.BeaconState.defaultValue();
    stateValue.slot = currentEpoch * SLOTS_PER_EPOCH;
    stateValue.validators = [
      {
        ...ssz.phase0.Validator.defaultValue(),
        pubkey: Buffer.alloc(48, 1),
        effectiveBalance: effectiveBalanceIncrements * EFFECTIVE_BALANCE_INCREMENT,
        slashed: true,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: currentEpoch + 1,
        withdrawableEpoch: currentEpoch + EPOCHS_PER_SLASHINGS_VECTOR / 2,
      },
    ];
    stateValue.balances = [effectiveBalanceIncrements * EFFECTIVE_BALANCE_INCREMENT];
    stateValue.previousEpochParticipation = [0];
    stateValue.currentEpochParticipation = [0];
    stateValue.inactivityScores = [0];
    stateValue.slashings[0] = totalSlashedIncrements * EFFECTIVE_BALANCE_INCREMENT;

    const state = ssz.electra.BeaconState.toViewDU(stateValue);
    const config = createBeaconConfig(
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
      }),
      state.genesisValidatorsRoot
    );
    const cachedState = createCachedBeaconState(
      state,
      {config, pubkeyCache},
      {skipSyncPubkeys: true, skipSyncCommitteeCache: true}
    );
    const cache = beforeProcessEpoch(cachedState);
    expect(cache.indicesToSlash).toEqual([0]);
    expect(cachedState.epochCtx.totalSlashingsByIncrement).toBe(totalSlashedIncrements);

    // Avoids building a state with ~37M ETH of active stake
    cache.totalActiveStakeByIncrement = totalActiveIncrements;
    const penalties = processSlashings(cachedState, cache, false);

    expect(penalties[0]).toBe(268_437_222 * effectiveBalanceIncrements);
  });
});
