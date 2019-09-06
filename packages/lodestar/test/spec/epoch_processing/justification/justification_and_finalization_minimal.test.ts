import {join} from "path";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processJustificationAndFinalization} from "../../../../src/chain/stateTransition/epoch/justification";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {BeaconStateComparisonCase} from "../../../utils/specTestTypes/beaconStateComparison";
import {BeaconState} from "@chainsafe/eth2.0-types";

describeMultiSpec<BeaconStateComparisonCase, BeaconState>(
  join(__dirname, "../../../../../spec-test-cases/tests/epoch_processing/justification_and_finalization/justification_and_finalization_minimal.yaml"),
  (state) => {
    processJustificationAndFinalization(config, state);
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

