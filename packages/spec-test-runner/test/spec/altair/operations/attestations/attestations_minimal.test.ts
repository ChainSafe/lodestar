import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {params} from "@chainsafe/lodestar-params/minimal";
import {allForks, altair, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IProcessAttestationTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IProcessAttestationTestCase, altair.BeaconState>(
  "process attestation minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/operations/attestation/pyspec_tests"),
  (testcase) => {
    const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
      config,
      testcase.pre as TreeBacked<altair.BeaconState>
    ) as CachedBeaconState<altair.BeaconState>;
    altair.processAttestation(wrappedState, testcase.attestation);
    return wrappedState;
  },
  {
    inputTypes: {
      pre: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      post: {
        type: InputType.SSZ_SNAPPY,
        treeBacked: true,
      },
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.altair.BeaconState,
      post: config.types.altair.BeaconState,
      attestation: config.types.phase0.Attestation,
    },

    timeout: 100000000,
    shouldError: (testCase) => !testCase.post,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);
