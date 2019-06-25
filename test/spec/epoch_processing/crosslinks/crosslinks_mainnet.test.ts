import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
import {processCrosslinks} from "../../../../src/chain/stateTransition/epoch/crosslinks";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "../../../../src/types";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/epoch_processing/crosslinks/crosslinks_mainnet.yaml"),
  processCrosslinks,
  (input) => {
    return [stateFromYaml(input.pre)];
  },
  (expected) => {
    return stateFromYaml(expected.post);
  },
  result => result,
  () => false,
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, BeaconState)).to.be.true;
  },
  0
);

