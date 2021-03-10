import {join} from "path";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {IProcessAttestationTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IProcessAttestationTestCase, phase0.BeaconState>(
  "process attestation minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/operations/attestation/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    phase0.processAttestation(config, state, testcase.attestation, verify);
    return state;
  },
  {
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
