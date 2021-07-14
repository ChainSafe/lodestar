import {altair, ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";

/**
 * Compare each field in BeaconState to help debug failed test easier.
 */
export function expectEqualBeaconState(expected: altair.BeaconState, actual: altair.BeaconState): void {
  const fields = ssz.altair.BeaconState.fields;
  for (const field of Object.keys(fields)) {
    expect(
      ssz.altair.BeaconState.fields[field].equals(
        (actual as Record<string, any>)[field],
        (expected as Record<string, any>)[field]
      ),
      `Failed at ${field} field`
    ).to.be.true;
  }
  expect(ssz.altair.BeaconState.equals(actual, expected)).to.be.true;
}
