import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";
import {expect} from "chai";

/**
 * Compare each field in BeaconState to help debug failed test easier.
 */
export function expectEqualBeaconState(
  config: IBeaconConfig,
  expected: altair.BeaconState,
  actual: altair.BeaconState
): void {
  const fields = config.types.altair.BeaconState.fields;
  for (const field of Object.keys(fields)) {
    expect(
      config.types.altair.BeaconState.fields[field].equals(
        (actual as Record<string, any>)[field],
        (expected as Record<string, any>)[field]
      ),
      `Failed at ${field} field`
    ).to.be.true;
  }
  expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
}
