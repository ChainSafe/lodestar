import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {depositsFromYaml} from "../../../utils/deposit";
import {processDeposit} from "../../../../src/chain/stateTransition/block/deposits";
import {equals, hashTreeRoot} from "@chainsafe/ssz";
import {BeaconState, Validator} from "../../../../src/types";


describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/deposit/deposit_mainnet.yaml"),
  processDeposit,
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [stateFromYaml(input.pre), depositsFromYaml(input.deposit)];
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
    expect(equals(expected, actual, BeaconState)).to.be.true;
    restore();
  },
  0
);

