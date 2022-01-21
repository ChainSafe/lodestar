import {join} from "node:path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {allForks, BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {bellatrix, ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../util";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest, shouldVerify} from "../type";
import {getConfig} from "./util";

/* eslint-disable @typescript-eslint/naming-convention */

export function sanity(fork: ForkName): void {
  sanitySlot(fork);
  sanityBlock(fork, `/tests/${ACTIVE_PRESET}/${fork}/sanity/blocks/pyspec_tests`);
}

export function sanitySlot(fork: ForkName): void {
  describeDirectorySpecTest<IProcessSlotsTestCase, BeaconStateAllForks>(
    `${ACTIVE_PRESET}/${fork}/sanity/slots`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/sanity/slots/pyspec_tests`),
    (testcase) => {
      const stateTB = testcase.pre.clone();
      const state = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const postState = allForks.processSlots(state, state.slot + bnToNum(testcase.slots));
      // TODO: May be part of runStateTranstion, necessary to commit again?
      postState.commit();
      return postState;
    },
    {
      inputTypes: {...inputTypeSszTreeViewDU, slots: InputType.YAML},
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
  describeDirectorySpecTest<IBlockSanityTestCase, BeaconStateAllForks>(
    `${ACTIVE_PRESET}/${fork}/sanity/blocks`,
    join(SPEC_TEST_LOCATION, testPath),
    (testcase) => {
      const stateTB = testcase.pre as BeaconStateAllForks;
      let wrappedState = createCachedBeaconStateTest(stateTB, getConfig(fork));
      const verify = shouldVerify(testcase);
      for (let i = 0; i < testcase.meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as bellatrix.SignedBeaconBlock;
        wrappedState = allForks.stateTransition(wrappedState, signedBlock, {
          verifyStateRoot: verify,
          verifyProposer: verify,
          verifySignatures: verify,
        });
      }
      return wrappedState;
    },
    {
      inputTypes: inputTypeSszTreeViewDU,
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
    blocks_count: number;
    bls_setting: bigint;
  };
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
}

interface IProcessSlotsTestCase extends IBaseSpecTest {
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
  slots: bigint;
}
