import {join} from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {TreeBacked} from "@chainsafe/ssz";
import {merge, ssz, Uint64} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {getConfig} from "./util";

export function sanity(fork: ForkName): void {
  sanitySlot(fork);
  sanityBlock(fork, `/tests/${ACTIVE_PRESET}/${fork}/sanity/blocks/pyspec_tests`);
}

export function sanitySlot(fork: ForkName): void {
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
      inputTypes: {...inputTypeSszTreeBacked, slots: InputType.YAML},
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
}

export function sanityBlock(fork: ForkName, testPath: string): void {
  describeDirectorySpecTest<IBlockSanityTestCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/sanity/blocks`,
    join(SPEC_TEST_LOCATION, testPath),
    (testcase) => {
      const stateTB = testcase.pre as TreeBacked<allForks.BeaconState>;
      let wrappedState = allForks.createCachedBeaconState(getConfig(fork), stateTB);
      const verify = testcase.meta !== undefined && testcase.meta.blsSetting === BigInt(1);
      for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
        const signedBlock = testcase[`blocks_${i}`] as merge.SignedBeaconBlock;
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
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 99),
      },
      shouldError: (testCase) => testCase.post === undefined,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );
}

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;

export function generateBlocksSZZTypeMapping(fork: ForkName, n: number): BlocksSZZTypeMapping {
  const blocksMapping: BlocksSZZTypeMapping = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz[fork].SignedBeaconBlock;
  }
  return blocksMapping;
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
