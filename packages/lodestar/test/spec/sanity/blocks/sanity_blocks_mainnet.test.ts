import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {hashTreeRoot, equals} from "@chainsafe/ssz";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";

import {stateTransition} from "../../../../chain/stateTransition";
import {BeaconBlock, BeaconState, Validator} from "../../../../../types";
import {expandYamlValue} from "../../../utils/expandYamlValue";

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
    return [expandYamlValue(input.pre, BeaconState), input.blocks.map((b) => expandYamlValue(b, BeaconBlock))];
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

