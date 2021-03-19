import {join} from "path";
import {expect} from "chai";
import {params} from "@chainsafe/lodestar-params/minimal";
import {lightclient} from "@chainsafe/lodestar-beacon-state-transition";
import {lightclient as lightclientTypes} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IBeaconConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSanityTestCase} from "./types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, LIGHTCLIENT_PATCH_FORK_SLOT: 0});

describeDirectorySpecTest<IBlockSanityTestCase, lightclientTypes.BeaconState>(
  "lightclient block sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/lightclient_patch/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let state = testcase.pre;
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      state = lightclient.stateTransition(
        config,
        state,
        testcase[`blocks_${i}`] as lightclientTypes.SignedBeaconBlock,
        {
          verifyStateRoot: verify,
          verifyProposer: verify,
          verifySignatures: verify,
        }
      );
    }
    return state;
  },
  {
    inputTypes: {
      meta: InputType.YAML,
    },
    sszTypes: {
      pre: config.types.lightclient.BeaconState,
      post: config.types.lightclient.BeaconState,
      ...generateBlocksSZZTypeMapping(99, config),
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.lightclient.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);

function generateBlocksSZZTypeMapping(
  n: number,
  config: IBeaconConfig
): Record<string, typeof config.types.lightclient.SignedBeaconBlock> {
  const blocksMapping: Record<string, typeof config.types.lightclient.SignedBeaconBlock> = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = config.types.lightclient.SignedBeaconBlock;
  }
  return blocksMapping;
}
