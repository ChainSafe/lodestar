import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {createCachedBeaconState} from "../../../src/cache/stateCache.js";
import {computeAttestationsRewards} from "../../../src/rewards/attestationsRewards.js";
import {CachedBeaconStateAltair} from "../../../src/types.js";
import {interopSecretKey} from "../../../src/util/interop.js";

const validatorCount = 16;
const TIMELY_ALL_FLAGS = 0b111;
const pubkeys = Array.from({length: validatorCount}, (_, i) => interopSecretKey(i).toPublicKey().toBytes());

function createAltairState(): CachedBeaconStateAltair {
  const {BeaconState} = ssz.altair;
  const state = BeaconState.defaultViewDU();
  state.slot = SLOTS_PER_EPOCH * 3;
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
    pubkeys.map(() => TIMELY_ALL_FLAGS)
  );
  state.currentEpochParticipation = BeaconState.fields.currentEpochParticipation.toViewDU(pubkeys.map(() => 0));
  state.inactivityScores = BeaconState.fields.inactivityScores.toViewDU(pubkeys.map(() => 0));

  const config = createBeaconConfig(createChainForkConfig({ALTAIR_FORK_EPOCH: 0}), state.genesisValidatorsRoot);
  return createCachedBeaconState(state, {config, pubkeyCache}, {skipSyncCommitteeCache: true});
}

describe("computeAttestationsRewards validator filter", () => {
  const unknownPubkey = toHex(new Uint8Array(48).fill(0xab));
  const testCases: {id: string; validatorIds: (number | string)[]; expected: number[]}[] = [
    {id: "no filter returns all validators", validatorIds: [], expected: pubkeys.map((_, i) => i)},
    {id: "unknown pubkey returns no validators", validatorIds: [unknownPubkey], expected: []},
    {
      id: "mixed ids return matches in validator index order",
      validatorIds: [toHex(pubkeys[9]), 3, unknownPubkey, 12],
      expected: [3, 9, 12],
    },
  ];

  for (const {id, validatorIds, expected} of testCases) {
    it(id, async () => {
      const state = createAltairState();
      const {totalRewards} = await computeAttestationsRewards(
        state.config,
        state.epochCtx.pubkeyCache,
        state,
        validatorIds
      );
      expect(totalRewards.map((reward) => reward.validatorIndex)).toEqual(expected);
    });
  }
});
