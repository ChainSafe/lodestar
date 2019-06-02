import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
import {processAttesterSlashing} from "../../../../src/chain/stateTransition/block/attesterSlashings";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {attesterSlashingFromYaml} from "../../../utils/attesterSlashing";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/attester_slashing/attester_slashing_mainnet.yaml"),
  processAttesterSlashing,
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [stateFromYaml(input.pre), attesterSlashingFromYaml(input.attesterSlashing)];
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

