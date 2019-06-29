import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import {hashTreeRoot} from "@chainsafe/ssz";
import sinon from "sinon";

import {processDeposit} from "../../../../src/chain/stateTransition/block/operations";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {BeaconState, Deposit, Validator} from "../../../../src/types";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/deposit/deposit_mainnet.yaml"),
  (state, deposit) => {
    processDeposit(state, deposit);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, BeaconState), expandYamlValue(input.deposit, Deposit)];
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

