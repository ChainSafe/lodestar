import {expect} from "chai";
import {allForks, altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconStatePhase0(expected: phase0.BeaconState, actual: phase0.BeaconState): void {
  if (!ssz.phase0.BeaconState.equals(actual, expected)) {
    expect(ssz.phase0.BeaconState.toJson(actual)).to.deep.equal(ssz.phase0.BeaconState.toJson(expected));
    throw Error("Wrong state");
  }
}

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconStateAltair(expected: altair.BeaconState, actual: altair.BeaconState): void {
  if (!ssz.altair.BeaconState.equals(actual, expected)) {
    expect(ssz.altair.BeaconState.toJson(actual)).to.deep.equal(ssz.altair.BeaconState.toJson(expected));
    throw Error("Wrong state");
  }
}

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconState(
  fork: ForkName,
  expected: allForks.BeaconState,
  actual: allForks.BeaconState
): void {
  switch (fork) {
    case ForkName.phase0:
      return expectEqualBeaconStatePhase0(expected as phase0.BeaconState, actual as phase0.BeaconState);
    case ForkName.altair:
      return expectEqualBeaconStateAltair(expected as altair.BeaconState, actual as altair.BeaconState);
  }
}
