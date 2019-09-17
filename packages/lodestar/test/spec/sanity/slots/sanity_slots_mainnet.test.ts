import {join} from "path";
import {describeMultiSpec} from "@chainsafe/eth2.0-spec-test-util";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
// @ts-ignore
import {restore, rewire} from "@chainsafe/bls";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {BeaconState, number64} from "@chainsafe/eth2.0-types";
import {processSlots} from "../../../../src/chain/stateTransition";
import {expandYamlValue} from "../../../utils/expandYamlValue";
import {SlotSanityCase} from "../../../utils/specTestTypes/beaconStateComparison";

describeMultiSpec<SlotSanityCase, BeaconState>(
  join(__dirname, "../../../../../spec-test-cases/tests/sanity/slots/sanity_slots_mainnet.yaml"),
  (state: BeaconState, slots: number64) => {
    processSlots(config, state, state.slot + slots);
    return state;
  },
  (input) => {
    if(input.bls_setting && input.bls_setting.toNumber() === 2) {
      rewire({
        verify: sinon.stub().returns(true),
        verifyMultiple: sinon.stub().returns(true)
      });
    }
    return [expandYamlValue(input.pre, config.types.BeaconState), input.slots.toNumber()];
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

