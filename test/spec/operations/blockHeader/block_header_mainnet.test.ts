import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
import processBlockHeader from "../../../../src/chain/stateTransition/block/blockHeader";
import {blockFromYaml} from "../../../utils/block";
// @ts-ignore
import {rewire, restore} from "@chainsafe/bls-js";
import sinon from "sinon";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "../../../../src/types";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/block_header/block_header_mainnet.yaml"),
  processBlockHeader,
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [stateFromYaml(input.pre), blockFromYaml(input.block)];
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

