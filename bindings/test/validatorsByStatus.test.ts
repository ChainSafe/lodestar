import {getValidatorStatus, mapToGeneralStatus, ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {createStfState, stfConfig} from "./stfFixture.js";

describe("BeaconStateView.getValidatorsByStatus", () => {
  const value = createStfState();
  const epoch = stfConfig.FULU_FORK_EPOCH;
  Object.assign(value.validators[1], {activationEligibilityEpoch: epoch - 1, activationEpoch: Infinity});
  Object.assign(value.validators[2], {exitEpoch: epoch - 1, withdrawableEpoch: epoch + 100});
  Object.assign(value.validators[3], {exitEpoch: epoch - 1, slashed: true, withdrawableEpoch: epoch + 100});
  Object.assign(value.validators[4], {effectiveBalance: 0, exitEpoch: epoch - 10, withdrawableEpoch: epoch - 1});

  bindings.pubkeys.ensureCapacity(value.validators.length);
  const config = new bindings.BeaconConfig(stfConfig, value.genesisValidatorsRoot);
  const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);

  it.each([
    [["active"]],
    [["pending"]],
    [["exited"]],
    [["withdrawal"]],
    [["active_ongoing"]],
    [["exited_slashed", "pending"]],
    [["unknown"]],
  ])("filters by %j", (statuses) => {
    const filter = new Set<string>(statuses);
    const expected = value.validators.filter((validator) => {
      const status = getValidatorStatus(validator, epoch);
      return filter.has(status) || filter.has(mapToGeneralStatus(status));
    });

    const actual = state.getValidatorsByStatus(filter, epoch);

    expect(actual.map((validator) => validator.pubkey)).toEqual(expected.map((validator) => validator.pubkey));
  });
});
