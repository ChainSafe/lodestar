import {
  getSourceDeltas,
  getTargetDeltas,
  getHeadDeltas,
  getInclusionDelayDeltas,
  getInactivityPenaltyDeltas,
} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {expect} from "chai";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {
  generateSZZTypeMapping,
  IAttestationDeltas,
  IAttestationDeltasType,
  IDeltas,
  IRewardsTestCase,
} from "./types";

["basic", "leak", "random"].forEach((testSuite) => {
  describeDirectorySpecTest<IRewardsTestCase, IAttestationDeltas>(
    "process attestation mainnet",
    join(SPEC_TEST_LOCATION, `/tests/mainnet/phase0/rewards/${testSuite}/pyspec_tests`),
    (testcase) => {
      const state = testcase.pre;
      const sourceDeltas = getSourceDeltas(config, state);
      const targetDeltas = getTargetDeltas(config, state);
      const headDeltas = getHeadDeltas(config, state);
      const inclusionDelayDeltas = getInclusionDelayDeltas(config, state);
      const inactivityPenaltyDeltas = getInactivityPenaltyDeltas(config, state);
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
        pre: config.types.BeaconState,
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
        expect(IAttestationDeltasType.equals(actual, expected)).to.be.true;
      },
    }
  );
});
