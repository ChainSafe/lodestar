import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {blockFromYaml} from "../../../utils/block";
import {BeaconBlock, BeaconState, number64, Validator} from "../../../../src/types";
import {stateTransition} from "../../../../src/chain/stateTransition";
import {hashTreeRoot} from "@chainsafe/ssz";

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
    return [stateFromYaml(input.pre), input.slots.toNumber()];
  },
  (expected) => {
    return stateFromYaml(expected.post);
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

