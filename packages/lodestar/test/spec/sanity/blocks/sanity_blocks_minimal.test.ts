import {join} from "path";
import {expect} from "chai";
import {equals, clone} from "@chainsafe/ssz";
import {BeaconBlock, BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {stateTransition} from "@chainsafe/eth2.0-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BlockSanityTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<BlockSanityTestCase, BeaconState>(
  "block sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let state = testcase.pre;
    for(let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      state = stateTransition(config, state, testcase[`blocks_${i}`] as BeaconBlock, true, true);
    }
    return state;
  },
  {
    // @ts-ignore
    inputTypes: {
      meta: InputType.YAML
    },
    // @ts-ignore
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
      expect(equals(actual, expected, config.types.BeaconState)).to.be.true;
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

