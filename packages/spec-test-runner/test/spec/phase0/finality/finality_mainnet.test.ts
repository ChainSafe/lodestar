import {join} from "path";
import {expect} from "chai";
import {TreeBacked} from "@chainsafe/ssz";
import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IFinalityTestCase} from "./type";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IFinalityTestCase, allForks.BeaconState>(
  "finality allForks",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/finality/finality/pyspec_tests"),
  (testcase) => {
    let wrappedState = allForks.createCachedBeaconState<allForks.BeaconState>(
      config,
      testcase.pre as TreeBacked<allForks.BeaconState>
    );
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      wrappedState = allForks.stateTransition(
        wrappedState as CachedBeaconState<allForks.BeaconState>,
        testcase[`blocks_${i}`] as phase0.SignedBeaconBlock,
        {
          verifyStateRoot: verify,
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
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      ...generateBlocksSZZTypeMapping(200, config),
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);

function generateBlocksSZZTypeMapping(
  n: number,
  config: IBeaconConfig
): Record<string, typeof config.types.phase0.SignedBeaconBlock> {
  const blocksMapping: Record<string, typeof config.types.phase0.SignedBeaconBlock> = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.phase0.SignedBeaconBlock;
  }
  return blocksMapping;
}
