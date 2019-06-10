import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {processTransfer} from "../../../../src/chain/stateTransition/block/transfers";
import {transfersFromYaml} from "../../../utils/transfer";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/transfer/transfer_mainnet.yaml"),
  processTransfer,
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [stateFromYaml(input.pre), transfersFromYaml(input.transfer)];
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
    //chai hates BN
    expected.balances = expected.balances.map(b => b.toString());
    actual.balances = actual.balances.map(b => b.toString());
    expect(expected).to.be.deep.equal(actual);
    restore();
  }
);

