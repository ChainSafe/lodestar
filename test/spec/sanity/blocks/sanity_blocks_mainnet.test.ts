import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {stateFromYaml} from "../../../utils/state";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";
import {blockFromYaml} from "../../../utils/block";
import {BeaconBlock, BeaconState, Validator} from "../../../../src/types";
import {stateTransition} from "../../../../src/chain/stateTransition";
import {hashTreeRoot} from "@chainsafe/ssz";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/sanity/blocks/sanity_blocks_mainnet.yaml"),
  (state: BeaconState, blocks: BeaconBlock[]) => {
    blocks.forEach((block) => {
      stateTransition(state, block, false);
    });
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
    return [stateFromYaml(input.pre), input.blocks.map(blockFromYaml)];
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
    expect(expected.balances).to.be.deep.equal(actual.balances);
    restore();
  },
  0
);

