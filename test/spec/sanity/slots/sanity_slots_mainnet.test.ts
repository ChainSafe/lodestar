import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {hashTreeRoot} from "@chainsafe/ssz";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";

import {stateTransition} from "../../../../src/chain/stateTransition";
import {BeaconState, number64, Validator} from "../../../../src/types";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/sanity/slots/sanity_slots_mainnet.yaml"),
  (state: BeaconState, slots: number64) => {
    for(let i = 0; i < slots; i++) {
      stateTransition(state, null, false);
    }
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
    if(expected && actual) {
      expected.balances = expected.balances.map(b => b.toString());
      actual.balances = actual.balances.map(b => b.toString());
      expected.validatorRegistry = expected.validatorRegistry.map(b => hashTreeRoot(b, Validator));
      actual.validatorRegistry = actual.validatorRegistry.map(b => hashTreeRoot(b, Validator));
    }
    expect(expected).to.be.deep.equal(actual);
    restore();
  },
  0
);

