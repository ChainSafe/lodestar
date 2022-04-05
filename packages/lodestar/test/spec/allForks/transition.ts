import {join} from "node:path";
import {allForks, BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {ForkName, ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../util";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState";

export function transition(
  forkConfig: (forkEpoch: number) => Partial<IChainConfig>,
  pre: ForkName,
  fork: Exclude<ForkName, ForkName.phase0>
): void {
  describeDirectorySpecTest<ITransitionTestCase, BeaconStateAllForks>(
    `${ACTIVE_PRESET}/${fork}/transition`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/transition/core/pyspec_tests`),
    (testcase) => {
      const meta = testcase.meta;
      // testConfig is used here to load forkEpoch from meta.yaml
      const testConfig = createIChainForkConfig(forkConfig(bnToNum(meta.fork_epoch)));
      let state = createCachedBeaconStateTest(testcase.pre, testConfig);
      for (let i = 0; i < meta.blocks_count; i++) {
        const signedBlock = testcase[`blocks_${i}`] as allForks.SignedBeaconBlock;
        state = allForks.stateTransition(state, signedBlock, {
          verifyStateRoot: true,
          verifyProposer: false,
          verifySignatures: false,
        });
      }
      return state;
    },
    {
      inputTypes: inputTypeSszTreeViewDU,
      getSszTypes: (meta: ITransitionTestCase["meta"]) => {
        return {
          pre: ssz[pre].BeaconState,
          post: ssz[fork].BeaconState,
          ...generateBlocksSZZTypeMapping(meta),
        };
      },
      shouldError: (testCase) => testCase.post === undefined,
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );

  /**
   * https://github.com/ethereum/eth2.0-specs/tree/v1.1.0-alpha.5/tests/formats/transition
   */
  function generateBlocksSZZTypeMapping(meta: ITransitionTestCase["meta"]): BlocksSZZTypeMapping {
    if (meta === undefined) {
      throw new Error("No meta data found");
    }
    const blocksMapping: BlocksSZZTypeMapping = {};
    // The fork_block is the index in the test data of the last block of the initial fork.
    for (let i = 0; i < meta.blocks_count; i++) {
      blocksMapping[`blocks_${i}`] = i <= meta.fork_block ? ssz[pre].SignedBeaconBlock : ssz[fork].SignedBeaconBlock;
    }
    return blocksMapping;
  }
}

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;

/* eslint-disable @typescript-eslint/naming-convention */
interface ITransitionTestCase extends IBaseSpecTest {
  [k: string]: allForks.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    post_fork: ForkName;
    fork_epoch: bigint;
    fork_block: bigint;
    blocks_count: bigint;
    bls_setting?: bigint;
  };
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
}
