import {expect} from "vitest";
import {allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {BeaconStateAllForks} from "@lodestar/state-transition";

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconState(
  fork: ForkName,
  expectedView: BeaconStateAllForks,
  actualView: BeaconStateAllForks
): void {
  // TODO: Is it cheaper to compare roots? Or maybe the serialized bytes?
  const expected = expectedView.toValue();
  const actual = actualView.toValue();

  const stateType = ssz[fork].BeaconState as allForks.AllForksSSZTypes["BeaconState"];
  if (!stateType.equals(actual, expected)) {
    expect(stateType.toJson(actual)).to.deep.equal(stateType.toJson(expected));
    throw Error("Wrong state");
  }
}

/** Shortcut for commonly used inputType */
export const inputTypeSszTreeViewDU = {
  pre: InputType.SSZ_SNAPPY,
  post: InputType.SSZ_SNAPPY,
  meta: InputType.YAML as const,
};
