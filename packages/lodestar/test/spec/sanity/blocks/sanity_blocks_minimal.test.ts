import {join} from "path";
import {expect} from "chai";
import {equals} from "@chainsafe/ssz";
import {BeaconBlock, BeaconState} from "@chainsafe/eth2.0-types";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {stateTransition} from "../../../../src/chain/stateTransition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BlockSanityTestCase} from "./type";

describeDirectorySpecTest<BlockSanityTestCase, BeaconState>(
  "block sanity minimal",
  join(__dirname, "../../../../../spec-test-cases/tests/minimal/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    const state = testcase.pre;
    for(let i = 0; i < testcase.meta.blocksCount.toNumber(); i++) {
      stateTransition(config, state, testcase[`blocks_${i}`] as BeaconBlock, true, true);
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
  const blocksMapping = {};
  for(let i = 0; i<n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.BeaconBlock;
  }
  return blocksMapping;
}

