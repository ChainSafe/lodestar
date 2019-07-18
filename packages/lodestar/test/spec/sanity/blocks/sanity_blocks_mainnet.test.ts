import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {hashTreeRoot, equals} from "@chainsafe/ssz";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls-js";
import sinon from "sinon";

import {BeaconBlock, BeaconState, Validator} from "../../../../src/types";
import {config} from "../../../../src/config/presets/mainnet";
import {stateTransition} from "../../../../src/chain/stateTransition";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/sanity/blocks/sanity_blocks_mainnet.yaml"),
  (state: BeaconState, blocks: BeaconBlock[]) => {
    blocks.forEach((block) => {
      stateTransition(config, state, block, false);
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
    return [expandYamlValue(input.pre, config.types.BeaconState), input.blocks.map((b) => expandYamlValue(b, config.types.BeaconBlock))];
  },
  (expected) => {
    return expandYamlValue(expected.post, config.types.BeaconState);
  },
  result => result,
  (testCase) => {
    return !testCase.post;
  },
  () => false,
  (_1, _2, expected, actual) => {
    expect(equals(expected, actual, config.types.BeaconState)).to.be.true;
    restore();
  },
  0
);

