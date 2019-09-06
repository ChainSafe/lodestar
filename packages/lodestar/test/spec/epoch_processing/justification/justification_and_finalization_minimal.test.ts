import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {processJustificationAndFinalization} from "../../../../src/chain/stateTransition/epoch/justification";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {StateTestCase} from "../../../utils/specTestTypes/stateTestCase";

describeDirectorySpecTest<StateTestCase, BeaconState>(
  "epoch justification and finalization minimal",
  join(__dirname, "../../../../../spec-test-cases/tests/minimal/phase0/epoch_processing/justification_and_finalization/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processJustificationAndFinalization(config, state);
    return state;
  },
  {
    inputTypes: {
      pre: InputType.SSZ,
      post: InputType.SSZ,
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
    },
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);

