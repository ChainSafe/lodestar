import {expect} from "chai";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";

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
