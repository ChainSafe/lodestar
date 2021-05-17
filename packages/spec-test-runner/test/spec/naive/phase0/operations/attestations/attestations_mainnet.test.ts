import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessAttestationTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../../utils/specTestCases";
import {phase0, naive} from "@chainsafe/lodestar-beacon-state-transition";

describeDirectorySpecTest<IProcessAttestationTestCase, phase0.BeaconState>(
  "process attestation mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/operations/attestation/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    naive.phase0.processAttestation(config, state, testcase.attestation, verify);
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      attestation: config.types.phase0.Attestation,
    },

    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
