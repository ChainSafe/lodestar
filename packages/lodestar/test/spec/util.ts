import {expect} from "chai";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {ContainerType} from "@chainsafe/ssz";

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconState(
  fork: ForkName,
  expected: allForks.BeaconState,
  actual: allForks.BeaconState
): void {
  const stateType = ssz[fork].BeaconState as ContainerType<allForks.BeaconState>;
  if (!stateType.equals(actual, expected)) {
    expect(stateType.toJson(actual)).to.deep.equal(stateType.toJson(expected));
    throw Error("Wrong state");
  }
}

/** Shortcut for commonly used inputType */
export const inputTypeSszTreeBacked = {
  pre: {type: InputType.SSZ_SNAPPY as const, treeBacked: true as const},
  post: {type: InputType.SSZ_SNAPPY as const, treeBacked: true as const},
  meta: InputType.YAML as const,
};
