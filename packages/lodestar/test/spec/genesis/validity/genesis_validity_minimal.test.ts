import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {isValidGenesisState} from "../../../../src/chain/genesis/genesis";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/genesis/validity/genesis_validity_minimal.yaml"),
  (state, transfer) => {
    return isValidGenesisState(config, state);
  },
  (input) => {
    return [expandYamlValue(input.genesis, config.types.BeaconState)];
  },
  (expected) => {
    return expandYamlValue(expected.isValid, config.types.bool);
  },
  result => result,
  (testCase) => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(actual).to.equal(expected);
  },
  0
);

