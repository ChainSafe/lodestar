import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {expect} from "chai";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {generateSZZTypeMapping, IAttestationDeltas, AttestationDeltasType, IDeltas, IRewardsTestCase} from "./types";

for (const testSuite of ["basic", "leak", "random"]) {
  describeDirectorySpecTest<IRewardsTestCase, IAttestationDeltas>(
    "process attestation mainnet",
    join(SPEC_TEST_LOCATION, `/tests/mainnet/phase0/rewards/${testSuite}/pyspec_tests`),
    (testcase) => {
      const state = testcase.pre;
      const sourceDeltas = phase0.getSourceDeltas(config, state);
      const targetDeltas = phase0.getTargetDeltas(config, state);
      const headDeltas = phase0.getHeadDeltas(config, state);
      const inclusionDelayDeltas = phase0.getInclusionDelayDeltas(config, state);
      const inactivityPenaltyDeltas = phase0.getInactivityPenaltyDeltas(config, state);
      return {
        sourceDeltas: {rewards: sourceDeltas[0], penalties: sourceDeltas[1]},
        targetDeltas: {rewards: targetDeltas[0], penalties: targetDeltas[1]},
        headDeltas: {rewards: headDeltas[0], penalties: headDeltas[1]},
        inclusionDelayDeltas: {rewards: inclusionDelayDeltas, penalties: []},
        inactivityPenaltyDeltas: {rewards: [], penalties: inactivityPenaltyDeltas},
      };
    },
    {
      inputTypes: {
        meta: InputType.YAML,
      },
      sszTypes: {
        pre: config.types.phase0.BeaconState,
        ...generateSZZTypeMapping(),
      },
      timeout: 100000000,
      shouldError: (testCase) => !testCase.post,
      getExpected: (testCase) => {
        return {
          sourceDeltas: testCase["source_deltas"] as IDeltas,
          targetDeltas: testCase["target_deltas"] as IDeltas,
          headDeltas: testCase["head_deltas"] as IDeltas,
          inclusionDelayDeltas: testCase["inclusion_delay_deltas"] as IDeltas,
          inactivityPenaltyDeltas: testCase["inactivity_penalty_deltas"] as IDeltas,
        };
      },
      expectFunc: (testCase, expected, actual) => {
        expect(AttestationDeltasType.equals(actual, expected)).to.be.true;
      },
    }
  );
}
