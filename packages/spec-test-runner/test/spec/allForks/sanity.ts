import {join} from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {altair, ssz, Uint64} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {expectEqualBeaconState} from "../util";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {IBaseSpecTest} from "../type";
import {getConfig} from "./util";

export function sanity(fork: ForkName): void {
  describeDirectorySpecTest<IProcessSlotsTestCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/sanity/slots`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/sanity/slots/pyspec_tests`),
    (testcase) => {
      const stateTB = (testcase.pre as TreeBacked<allForks.BeaconState>).clone();
      const state = allForks.createCachedBeaconState(getConfig(fork), stateTB);
      const postState = allForks.processSlots(state, state.slot + Number(testcase.slots));
      return postState.type.createTreeBacked(postState.tree);
    },
    {
      inputTypes: {
        pre: {type: InputType.SSZ_SNAPPY, treeBacked: true},
        post: {type: InputType.SSZ_SNAPPY, treeBacked: true},
        slots: InputType.YAML,
      },
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
      },
      shouldError: (testCase) => !testCase.post,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );

  const typeSignedBeaconBlock = ssz[fork].SignedBeaconBlock;
  function generateBlocksSZZTypeMapping(n: number): Record<string, typeof typeSignedBeaconBlock> {
    const blocksMapping: Record<string, typeof typeSignedBeaconBlock> = {};
    for (let i = 0; i < n; i++) {
      blocksMapping[`blocks_${i}`] = typeSignedBeaconBlock;
    }
    return blocksMapping;
  }

  describeDirectorySpecTest<IBlockSanityTestCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/sanity/blocks`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/sanity/blocks/pyspec_tests`),
    (testcase) => {
      const stateTB = testcase.pre as TreeBacked<allForks.BeaconState>;
      let wrappedState = allForks.createCachedBeaconState(getConfig(fork), stateTB);
      const verify = !!testcase.meta && !!testcase.meta.blsSetting && testcase.meta.blsSetting === BigInt(1);
      for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
        const signedBlock = testcase[`blocks_${i}`] as altair.SignedBeaconBlock;
        wrappedState = allForks.stateTransition(
          wrappedState,
          ssz[fork].SignedBeaconBlock.createTreeBackedFromStruct(signedBlock),
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
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(99),
      },
      shouldError: (testCase) => !testCase.post,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );
}

interface IBlockSanityTestCase extends IBaseSpecTest {
  [k: string]: allForks.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: allForks.BeaconState;
  post: allForks.BeaconState;
}

interface IProcessSlotsTestCase extends IBaseSpecTest {
  pre: allForks.BeaconState;
  post?: allForks.BeaconState;
  slots: Uint64;
}
