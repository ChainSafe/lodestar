import {expect} from "vitest";
import {ForkAll, ForkName} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {SSZTypesFor, ssz} from "@lodestar/types";

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconState(
  fork: ForkName,
  expectedView: BeaconStateAllForks,
  actualView: BeaconStateAllForks
): void {
  // TODO: Is it cheaper to compare roots? Or maybe the serialized bytes?
  const expected = expectedView.toValue();
  const actual = actualView.toValue();

  const stateType = ssz[fork].BeaconState as SSZTypesFor<ForkAll, "BeaconState">;
  if (!stateType.equals(actual, expected)) {
    expect(stateType.toJson(actual)).toEqualWithMessage(stateType.toJson(expected), "Wrong state");
  }
}

/** Shortcut for commonly used inputType */
export const inputTypeSszTreeViewDU = {
  pre: InputType.SSZ_SNAPPY,
  post: InputType.SSZ_SNAPPY,
  meta: InputType.YAML as const,
};
