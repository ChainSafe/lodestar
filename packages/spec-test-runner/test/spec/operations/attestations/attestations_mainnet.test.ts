import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processAttestation} from "@chainsafe/eth2.0-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IProcessAttestationTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessAttestationTestCase, BeaconState>(
  "process attestation mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/attestation/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    processAttestation(config, state, testcase.attestation, verify);
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      attestation: config.types.Attestation,
    },

    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(config.types.BeaconState, actual, expected)).to.be.true;
    }
  }
);
