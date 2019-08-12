import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processFinalUpdates} from "../../../../src/chain/stateTransition/epoch/finalUpdates";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/final_updates/final_updates_mainnet.yaml"),
  (state) => {
    processFinalUpdates(config, state);
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
  (_, i) => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, config.types.BeaconState)).to.be.true;
  },
  0
);

