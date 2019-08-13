import {join} from "path";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";
import sinon from "sinon";
import {equals} from "@chainsafe/ssz";

import {BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processBlockHeader} from "../../../../src/chain/stateTransition/block/blockHeader";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {BlockHeaderCase} from "../../../utils/specTestTypes/beaconStateComparison";

describeMultiSpec<BlockHeaderCase, BeaconState>(
  join(__dirname, "../../test-cases/tests/operations/block_header/block_header_mainnet.yaml"),
  (state, block) => {
    processBlockHeader(config, state, block);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, config.types.BeaconState), expandYamlValue(input.block, config.types.BeaconBlock)];
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

