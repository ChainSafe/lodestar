import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {blockFromYaml} from "../../../utils/block";
import {BeaconBlock, BeaconState, number64} from "../../../../src/types";
import {executeStateTransition} from "../../../../src/chain/stateTransition";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/sanity/slots/slotsanity_s_mainnet.yaml"),
  (state: BeaconState, slots: number64) => {
    for(let i = 0; i < slots; i++) {
      executeStateTransition(state, null);
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
    expect(expected).to.be.deep.equal(actual);
    restore();
  }
);

