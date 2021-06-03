import {join} from "path";
import {expect} from "chai";

import {TreeBacked} from "@chainsafe/ssz";
import {allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IBlockSanityTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {BeaconState} from "@chainsafe/lodestar-types/phase0";
import {ssz} from "@chainsafe/lodestar-types";

describeDirectorySpecTest<IBlockSanityTestCase, allForks.BeaconState>(
  "block sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let wrappedState = allForks.createCachedBeaconState<allForks.BeaconState>(
      config,
      testcase.pre as TreeBacked<allForks.BeaconState>
    );
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      wrappedState = allForks.stateTransition(wrappedState, testcase[`blocks_${i}`] as phase0.SignedBeaconBlock, {
        verifyStateRoot: verify,
        verifyProposer: verify,
        verifySignatures: verify,
      });
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
      pre: ssz.phase0.BeaconState,
      post: ssz.phase0.BeaconState,
      ...generateBlocksSZZTypeMapping(99),
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post as BeaconState,
    expectFunc: (testCase, expected, actual) => {
      expect(ssz.phase0.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);

function generateBlocksSZZTypeMapping(n: number): Record<string, typeof ssz.phase0.SignedBeaconBlock> {
  const blocksMapping: Record<string, typeof ssz.phase0.SignedBeaconBlock> = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz.phase0.SignedBeaconBlock;
  }
  return blocksMapping;
}
