import {TreeBacked} from "@chainsafe/ssz";
import {fast, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {generateSZZTypeMapping, IDeltas, DeltasType, IRewardsTestCase} from "./types";
import {expect} from "chai";

for (const testSuite of ["basic", "leak", "random"]) {
  describeDirectorySpecTest<IRewardsTestCase, IDeltas>(
    "process attestation mainnet",
    join(SPEC_TEST_LOCATION, `/tests/mainnet/phase0/rewards/${testSuite}/pyspec_tests`),
    (testcase) => {
      const wrappedState = fast.createCachedBeaconState<phase0.BeaconState>(
        config,
        testcase.pre as TreeBacked<phase0.BeaconState>
      );
      const process = fast.prepareEpochProcessState(wrappedState);
      const [rewards, penalties] = phase0.fast.getAttestationDeltas(wrappedState, process);
      return {
        rewards: rewards.map((reward) => BigInt(reward)),
        penalties: penalties.map((pen) => BigInt(pen)),
      };
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
        pre: config.types.phase0.BeaconState,
        ...generateSZZTypeMapping(),
      },
      timeout: 100000000,
      shouldError: (testCase) => !testCase.post,
      getExpected: (testCase) => {
        const sourceDeltas = testCase["source_deltas"] as IDeltas;
        const targetDeltas = testCase["target_deltas"] as IDeltas;
        const headDeltas = testCase["head_deltas"] as IDeltas;
        const inclusionDelayDeltas = testCase["inclusion_delay_deltas"] as IDeltas;
        const inactivityPenaltyDeltas = testCase["inactivity_penalty_deltas"] as IDeltas;
        const rewards = [
          sourceDeltas.rewards,
          targetDeltas.rewards,
          headDeltas.rewards,
          inclusionDelayDeltas.rewards,
          inactivityPenaltyDeltas.rewards,
        ].reduce((previousValue, currentValue) => {
          for (const index of previousValue.keys()) previousValue[index] += currentValue[index];
          return previousValue;
        });
        const penalties = [
          sourceDeltas.penalties,
          targetDeltas.penalties,
          headDeltas.penalties,
          inclusionDelayDeltas.penalties,
          inactivityPenaltyDeltas.penalties,
        ].reduce((previousValue, currentValue) => {
          for (const index of previousValue.keys()) previousValue[index] += currentValue[index];
          return previousValue;
        });
        return {
          rewards,
          penalties,
        };
      },
      expectFunc: (testCase, expected, actual) => {
        expect(DeltasType.equals(actual, expected)).to.be.true;
      },
    }
  );
}
