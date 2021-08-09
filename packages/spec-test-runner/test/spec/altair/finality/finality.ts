import {join} from "path";
import {TreeBacked} from "@chainsafe/ssz";
import {CachedBeaconState, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IFinalityTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {expectEqualBeaconStateAltair} from "../../util";
import {ssz} from "@chainsafe/lodestar-types";
import {PresetName} from "@chainsafe/lodestar-params";

export function runFinality(presetName: PresetName): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig({ALTAIR_FORK_EPOCH: 0});

  describeDirectorySpecTest<IFinalityTestCase, allForks.BeaconState>(
    `finality altair ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/finality/finality/pyspec_tests`),
    (testcase) => {
      let wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
        config,
        testcase.pre as TreeBacked<altair.BeaconState>
      ) as CachedBeaconState<allForks.BeaconState>;
      const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
      for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
        const signedBlock = testcase[`blocks_${i}`] as altair.SignedBeaconBlock;

        wrappedState = allForks.stateTransition(
          wrappedState,
          ssz.altair.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock),
          {
            verifyStateRoot: false,
            verifyProposer: verify,
            verifySignatures: verify,
          }
        );
      }
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
        pre: ssz.altair.BeaconState,
        post: ssz.altair.BeaconState,
        ...generateBlocksSZZTypeMapping(200),
      },
      shouldError: (testCase) => {
        return !testCase.post;
      },
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}

function generateBlocksSZZTypeMapping(n: number): Record<string, typeof ssz.altair.SignedBeaconBlock> {
  const blocksMapping: Record<string, typeof ssz.altair.SignedBeaconBlock> = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz.altair.SignedBeaconBlock;
  }
  return blocksMapping;
}
