import {join} from "path";
import {expect} from "chai";
import {BeaconBlock, BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {stateTransition} from "@chainsafe/eth2.0-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IBlockSanityTestCase} from "./type";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IBlockSanityTestCase, BeaconState>(
  "block sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    for(let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      state = stateTransition(config, state, testcase[`blocks_${i}`] as BeaconBlock, verify, verify, verify);
    }
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML
    },
    sszTypes: {
      pre: config.types.BeaconState,
      post: config.types.BeaconState,
      ...generateBlocksSZZTypeMapping(99, config)
    },
    shouldError: (testCase => {
      return !testCase.post;
    }),
    timeout: 10000000,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

function generateBlocksSZZTypeMapping(n: number, config: IBeaconConfig): object {
  const blocksMapping:any = {};
  for(let i = 0; i<n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.BeaconBlock;
  }
  return blocksMapping;
}
