import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH, ForkName, SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {upgradeStateToGloas} from "../../../src/slot/upgradeStateToGloas.js";
import type {CachedBeaconStateFulu} from "../../../src/types.js";

const config = createBeaconConfig(getConfig(ForkName.fulu), Buffer.alloc(32));

describe("upgradeStateToGloas payload availability", () => {
  for (const forkSlot of [SLOTS_PER_EPOCH, SLOTS_PER_HISTORICAL_ROOT]) {
    it(`clears only the fork slot at ${forkSlot}`, () => {
      const state = ssz.fulu.BeaconState.defaultViewDU();
      state.slot = forkSlot;
      for (let i = 0; i < 64; i++) {
        const validator = ssz.phase0.Validator.defaultValue();
        validator.pubkey = Buffer.alloc(48, i + 1);
        validator.effectiveBalance = 32e9;
        validator.activationEligibilityEpoch = 0;
        validator.activationEpoch = 0;
        validator.exitEpoch = FAR_FUTURE_EPOCH;
        validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
        state.validators.push(ssz.phase0.Validator.toViewDU(validator));
        state.balances.push(32e9);
      }
      state.commit();
      const pre = createCachedBeaconState(
        state,
        {config, pubkeyCache},
        {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
      ) as CachedBeaconStateFulu;
      const post = upgradeStateToGloas(pre);
      for (let index = 0; index < SLOTS_PER_HISTORICAL_ROOT; index++) {
        expect(post.executionPayloadAvailability.get(index), `forkSlot=${forkSlot}, index=${index}`).toBe(
          index !== forkSlot % SLOTS_PER_HISTORICAL_ROOT
        );
      }
    });
  }
});
