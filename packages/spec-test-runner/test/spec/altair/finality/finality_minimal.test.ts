import {join} from "path";
import {expect} from "chai";
import {TreeBacked} from "@chainsafe/ssz";
import {CachedBeaconState, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {params} from "@chainsafe/lodestar-params/minimal";
import {createIBeaconConfig, IBeaconConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IFinalityTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IFinalityTestCase, allForks.BeaconState>(
  "finality altair minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/finality/finality/pyspec_tests"),
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
        config.types.altair.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock),
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
      pre: config.types.altair.BeaconState,
      post: config.types.altair.BeaconState,
      ...generateBlocksSZZTypeMapping(200, config),
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);

function generateBlocksSZZTypeMapping(
  n: number,
  config: IBeaconConfig
): Record<string, typeof config.types.altair.SignedBeaconBlock> {
  const blocksMapping: Record<string, typeof config.types.altair.SignedBeaconBlock> = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.altair.SignedBeaconBlock;
  }
  return blocksMapping;
}
