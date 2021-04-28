import {join} from "path";
import {expect} from "chai";
import {altair} from "@chainsafe/lodestar-beacon-state-transition";
import {altair as altairTypes} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IBeaconConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSanityTestCase} from "./types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {params} from "@chainsafe/lodestar-params/mainnet";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IBlockSanityTestCase, altairTypes.BeaconState>(
  "altair block sanity mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/altair/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let state = testcase.pre;
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      state = altair.stateTransition(config, state, testcase[`blocks_${i}`] as altairTypes.SignedBeaconBlock, {
        verifyStateRoot: verify,
        verifyProposer: verify,
        verifySignatures: verify,
      });
    }
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.altair.BeaconState,
      post: config.types.altair.BeaconState,
      ...generateBlocksSZZTypeMapping(99, config),
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
