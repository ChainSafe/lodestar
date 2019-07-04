import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {equals} from "@chainsafe/ssz";
import {processVoluntaryExit} from "../../../../chain/stateTransition/block/operations";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {BeaconState, VoluntaryExit} from "../../../../../types";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/voluntary_exit/voluntary_exit_mainnet.yaml"),
  (state, exit) => {
    processVoluntaryExit(state, exit);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, BeaconState), expandYamlValue(input.voluntaryExit, VoluntaryExit)];
  },
  (expected) => {
    return expandYamlValue(expected.post, BeaconState);
  },
  result => result,
  (testCase) => {
    return !testCase.post;
  },
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, BeaconState)).to.be.true;
    restore();
  },
  0
);

