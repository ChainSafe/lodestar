import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {processCrosslinks} from "../../../../chain/stateTransition/epoch/crosslinks";
import {BeaconState} from "../../../../../types";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {equals} from "@chainsafe/ssz";
describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/crosslinks/crosslinks_mainnet.yaml"),
  processCrosslinks,
  (input) => {
    return [expandYamlValue(input.pre, BeaconState)];
  },
  (expected) => {
    return expandYamlValue(expected.post, BeaconState);
  },
  result => result,
  () => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, BeaconState)).to.be.true;
  },
  0
);

