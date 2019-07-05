import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import sinon from "sinon";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import {equals} from "@chainsafe/ssz";
import {processAttesterSlashing} from "../../../../src/chain/stateTransition/block/operations";
import {BeaconState, AttesterSlashing} from "@chainsafe/eth2-types";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/attester_slashing/attester_slashing_mainnet.yaml"),
  (state, attesterSlashing) => {
    processAttesterSlashing(state, attesterSlashing);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true),
        aggregatePubkeys: sinon.stub().returns(Buffer.alloc(48))
      });
    }
    return [expandYamlValue(input.pre, BeaconState), expandYamlValue(input.attesterSlashing, AttesterSlashing)];
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

