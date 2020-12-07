import {join} from "path";
import {expect} from "chai";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {EpochContext, fastStateTransition, IStateContext} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IFinalityTestCase} from "./type";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";

describeDirectorySpecTest<IFinalityTestCase, BeaconState>(
  "finality fast",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/finality/finality/pyspec_tests"),
  (testcase) => {
    const state = config.types.BeaconState.tree.createValue(testcase.pre);
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    let stateContext: IStateContext = {epochCtx, state};
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      stateContext = fastStateTransition(stateContext, testcase[`blocks_${i}`] as SignedBeaconBlock, {
        verifyStateRoot: verify,
        verifyProposer: verify,
        verifySignatures: verify,
      });
    }
    return stateContext.state;
  },
  {
    inputTypes: {
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      ...generateBlocksSZZTypeMapping(200, config),
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);

function generateBlocksSZZTypeMapping(
  n: number,
  config: IBeaconConfig
): Record<string, typeof config.types.SignedBeaconBlock> {
  const blocksMapping: any = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.SignedBeaconBlock;
  }
  return blocksMapping;
}
