import {join} from "path";
import {expect} from "chai";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {EpochContext, fastStateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IBlockSanityTestCase} from "./type";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IBlockSanityTestCase, BeaconState>(
  "block sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let state = testcase.pre;
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      ({state} = fastStateTransition({epochCtx, state}, testcase[`blocks_${i}`] as SignedBeaconBlock, {
        verifyStateRoot: verify,
        verifyProposer: verify,
        verifySignatures: verify,
      }));
    }
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      ...generateBlocksSZZTypeMapping(99, config),
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

function generateBlocksSZZTypeMapping(n: number, config: IBeaconConfig): object {
  const blocksMapping: any = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.SignedBeaconBlock;
  }
  return blocksMapping;
}
