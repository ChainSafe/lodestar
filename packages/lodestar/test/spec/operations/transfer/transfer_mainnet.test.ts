import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {processTransfer} from "../../../../src/chain/stateTransition/block/operations";
import {BeaconState, Transfer} from "@chainsafe/eth2-types";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {equals} from "@chainsafe/ssz";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/transfer/transfer_mainnet.yaml"),
  (state, transfer) => {
    processTransfer(state, transfer);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, BeaconState), expandYamlValue(input.transfer, Transfer)];
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

