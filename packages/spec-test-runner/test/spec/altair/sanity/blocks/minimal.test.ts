import {join} from "path";
import {params} from "@chainsafe/lodestar-params/minimal";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {altair as altairTypes, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {IBlockSanityTestCase} from "./types";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {TreeBacked} from "@chainsafe/ssz";
import {expectEqualBeaconState} from "../../util";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<IBlockSanityTestCase, allForks.BeaconState>(
  "altair block sanity minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/sanity/blocks/pyspec_tests"),
  (testcase) => {
    let wrappedState = allForks.createCachedBeaconState<allForks.BeaconState>(
      config,
      testcase.pre as TreeBacked<allForks.BeaconState>
    );
    const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
    for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
      const signedBlock = testcase[`blocks_${i}`] as altairTypes.SignedBeaconBlock;
      wrappedState = allForks.stateTransition(
        wrappedState,
        ssz.altair.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock),
        {
          verifyStateRoot: verify,
          verifyProposer: verify,
          verifySignatures: verify,
        }
      );
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
      pre: ssz.altair.BeaconState,
      post: ssz.altair.BeaconState,
      ...generateBlocksSZZTypeMapping(99),
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(config, expected, actual);
    },
  }
);

function generateBlocksSZZTypeMapping(n: number): Record<string, typeof ssz.altair.SignedBeaconBlock> {
  const blocksMapping: Record<string, typeof ssz.altair.SignedBeaconBlock> = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz.altair.SignedBeaconBlock;
  }
  return blocksMapping;
}
