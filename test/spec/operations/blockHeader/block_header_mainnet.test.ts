import {join} from "path";
import {describeSpecTest} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {rewire, restore} from "@chainsafe/bls-js";
import sinon from "sinon";

import {processBlockHeader} from "../../../../src/chain/stateTransition/block/blockHeader";
import {BeaconBlock, BeaconState} from "../../../../src/types";
import {expandYamlValue} from "../../../utils/expandYamlValue";

describeSpecTest(
  join(__dirname, "../../test-cases/tests/operations/block_header/block_header_mainnet.yaml"),
  (state, block) => {
    processBlockHeader(state, block);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, BeaconState), expandYamlValue(input.block, BeaconBlock)];
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
    expect(expected).to.be.deep.equal(actual);
    restore();
  },
  0
);

