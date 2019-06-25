import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {processProposerSlashing} from "../../../../src/chain/stateTransition/block/proposerSlashings";
import {proposerSlashingFromYaml} from "../../../utils/proposerSlashing";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/proposer_slashing/proposer_slashing_mainnet.yaml"),
  processProposerSlashing,
  (input) => {
    restore();
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [stateFromYaml(input.pre), proposerSlashingFromYaml(input.proposerSlashing)];
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
  },
  0
);

