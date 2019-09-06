import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {processAttestation} from "../../../../src/chain/stateTransition/block/operations";
import {describeDirectorySpecTest} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {ProcessAttestationTestCase} from "./type";

describeDirectorySpecTest<ProcessAttestationTestCase, BeaconState>(
  "process attestation mainnet",
  join(__dirname, "../../../../../spec-test-cases/tests/mainnet/phase0/operations/attestation/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    processAttestation(config, state, testcase.attestation);
    return state;
  },
  {
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      attestation: config.types.Attestation,
    },
    timeout: 100000000,
    shouldError: testCase => !testCase.post,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
    }
  }
);