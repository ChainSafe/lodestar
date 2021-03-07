import {join} from "path";
import {expect} from "chai";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IBlockSanityTestCase} from "./type";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IBlockSanityTestCase, phase0.BeaconState>(
  "block sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    const state = config.types.phase0.BeaconState.tree.createValue(testcase.pre);
    const wrappedState = phase0.fast.createCachedValidatorsBeaconState(state);
    const epochCtx = new phase0.fast.EpochContext(config);
    epochCtx.loadState(wrappedState);
    let stateContext = {epochCtx, state: wrappedState};
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      stateContext = phase0.fast.fastStateTransition(
        stateContext,
        testcase[`blocks_${i}`] as phase0.SignedBeaconBlock,
        {
          verifyStateRoot: verify,
          verifyProposer: verify,
          verifySignatures: verify,
        }
      );
    }
    return stateContext.state.getOriginalState();
  },
  {
    inputTypes: {
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.phase0.BeaconState,
      post: config.types.phase0.BeaconState,
      ...generateBlocksSZZTypeMapping(99, config),
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
  const blocksMapping: any = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.phase0.SignedBeaconBlock;
  }
  return blocksMapping;
}
