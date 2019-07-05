import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {hashTreeRoot, equals} from "@chainsafe/ssz";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {processSlots} from "../../../../src/chain/stateTransition";
import {BeaconState, number64, Validator} from "@chainsafe/eth2-types";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/sanity/slots/sanity_slots_mainnet.yaml"),
  (state: BeaconState, slots: number64) => {
    processSlots(state, state.slot + slots);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, BeaconState), input.slots.toNumber()];
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

