import {expect} from "vitest";
import {ForkAll, ForkName} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {SSZTypesFor, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";

/** Compare each field in BeaconState to help debug failed test easier. */
export function expectEqualBeaconState(
  fork: ForkName,
  expectedView: BeaconStateAllForks,
  actualView: BeaconStateAllForks
): void {
  const expectedRoot = expectedView.hashTreeRoot();
  const actualRoot = actualView.hashTreeRoot();
  if (byteArrayEquals(actualRoot, expectedRoot)) {
    return;
  }

  const stateType = ssz[fork].BeaconState as SSZTypesFor<ForkAll, "BeaconState">;
  let expected: ReturnType<typeof expectedView.toValue>;
  let actual: ReturnType<typeof actualView.toValue>;
  try {
    expected = expectedView.toValue();
    actual = actualView.toValue();
  } catch {
    expect(toRootHex(actualRoot)).toEqualWithMessage(toRootHex(expectedRoot), "Wrong state root");
    return;
  }

  if (!stateType.equals(actual, expected)) {
    let expectedJson: unknown;
    let actualJson: unknown;
    try {
      expectedJson = stateType.toJson(expected);
      actualJson = stateType.toJson(actual);
    } catch {
      expect(toRootHex(actualRoot)).toEqualWithMessage(toRootHex(expectedRoot), "Wrong state root");
      return;
    }
    expect(actualJson).toEqualWithMessage(expectedJson, "Wrong state");
  }
}

/** Shortcut for commonly used inputType */
export const inputTypeSszTreeViewDU = {
  pre: InputType.SSZ_SNAPPY,
  post: InputType.SSZ_SNAPPY,
  meta: InputType.YAML as const,
};
