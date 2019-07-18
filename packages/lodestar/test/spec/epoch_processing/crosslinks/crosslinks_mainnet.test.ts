import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";

import {config} from "../../../../src/config/presets/mainnet";
import {processCrosslinks} from "../../../../src/chain/stateTransition/epoch/crosslinks";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/crosslinks/crosslinks_mainnet.yaml"),
  (state) => {
    processCrosslinks(config, state);
    return state;
  },
  (input) => {
    return [expandYamlValue(input.pre, config.types.BeaconState)];
  },
  (expected) => {
    return expandYamlValue(expected.post, config.types.BeaconState);
  },
  result => result,
  () => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, config.types.BeaconState)).to.be.true;
  },
  0
);

