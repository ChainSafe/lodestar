import fs from "fs";
import {join} from "path";
import {expect} from "chai";
import {TreeBacked, ContainerType, ListType} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/default";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {ssz, Gwei} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, VALIDATOR_REGISTRY_LIMIT} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {IBaseSpecTest} from "../type";
import {inputTypeSszTreeBacked} from "../util";

// eslint-disable-next-line @typescript-eslint/naming-convention
const DeltasType = new ContainerType({
  fields: {
    rewards: new ListType({
      elementType: ssz.Gwei,
      limit: VALIDATOR_REGISTRY_LIMIT,
    }),
    penalties: new ListType({
      elementType: ssz.Gwei,
      limit: VALIDATOR_REGISTRY_LIMIT,
    }),
  },
});

const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/phase0/rewards`);
for (const testDir of fs.readdirSync(rootDir)) {
  describeDirectorySpecTest<IRewardsTestCase, IDeltas>(
    `${ACTIVE_PRESET}/phase0/rewards/${testDir}`,
    join(rootDir, `${testDir}/pyspec_tests`),
    (testcase) => {
      const wrappedState = allForks.createCachedBeaconState(config, testcase.pre as TreeBacked<phase0.BeaconState>);
      const epochProcess = allForks.beforeProcessEpoch(wrappedState);
      const [rewards, penalties] = phase0.getAttestationDeltas(wrappedState, epochProcess);
      return {
        rewards: rewards.map((reward) => BigInt(reward)),
        penalties: penalties.map((pen) => BigInt(pen)),
      };
    },
    {
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz.phase0.BeaconState,
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

interface IDeltas {
  rewards: Gwei[];
  penalties: Gwei[];
}

interface IRewardsTestCase extends IBaseSpecTest {
  [k: string]: IDeltas | unknown | null | undefined;
  pre: phase0.BeaconState;
}

function generateSZZTypeMapping(): Record<string, unknown> {
  const typeMappings: Record<string, unknown> = {};
  typeMappings["source_deltas"] = DeltasType;
  typeMappings["target_deltas"] = DeltasType;
  typeMappings["head_deltas"] = DeltasType;
  typeMappings["inclusion_delay_deltas"] = DeltasType;
  typeMappings["inactivity_penalty_deltas"] = DeltasType;
  return typeMappings;
}
