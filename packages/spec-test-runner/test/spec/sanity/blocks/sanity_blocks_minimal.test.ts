import {join} from "path";
import {expect} from "chai";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {stateTransition} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSanityTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IBlockSanityTestCase, BeaconState>(
  "block sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let state = testcase.pre;
    const verify = (!!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === 1n);
    for(let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      state = stateTransition(config, state, testcase[`blocks_${i}`] as SignedBeaconBlock, verify, verify, verify);
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
    timeout: 60000,
    getExpected: (testCase => testCase.post),
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.BeaconState.equals(actual, expected)).to.be.true;
    }
  }
);

function generateBlocksSZZTypeMapping(n: number, config: IBeaconConfig): object {
  const blocksMapping:any = {};
  for(let i = 0; i<n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.SignedBeaconBlock;
  }
  return blocksMapping;
}

