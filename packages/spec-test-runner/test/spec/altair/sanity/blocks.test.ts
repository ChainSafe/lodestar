import {join} from "path";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {altair as altairTypes, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {TreeBacked} from "@chainsafe/ssz";
import {altair, Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {expectEqualBeaconStateAltair} from "../../util";
import {config} from "../util";

describeDirectorySpecTest<IBlockSanityTestCase, allForks.BeaconState>(
  `${ACTIVE_PRESET}/altair/sanity/blocks`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/altair/sanity/blocks/pyspec_tests`),
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
      pre: {type: InputType.SSZ_SNAPPY, treeBacked: true},
      post: {type: InputType.SSZ_SNAPPY, treeBacked: true},
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
      expectEqualBeaconStateAltair(expected, actual);
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

interface IBlockSanityTestCase extends IBaseSpecTest {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: altair.BeaconState;
  post: altair.BeaconState;
}
