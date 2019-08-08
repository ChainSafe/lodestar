import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processCrosslinks} from "../../../../src/chain/stateTransition/epoch/crosslinks";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {BeaconStateComparisonCase} from "../../../utils/specTestTypes/beaconStateComparison";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";

describeMultiSpec<BeaconStateComparisonCase, BeaconState>(
  join(__dirname, "../../test-cases/tests/epoch_processing/crosslinks/crosslinks_minimal.yaml"),
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

