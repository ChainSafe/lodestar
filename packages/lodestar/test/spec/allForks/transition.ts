import {join} from "node:path";
import {allForks, createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {ForkName, ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {TreeBacked} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {bnToNum} from "@chainsafe/lodestar-utils";

type CreateTreeBackedSignedBlock = (block: allForks.SignedBeaconBlock) => TreeBacked<allForks.SignedBeaconBlock>;
const createTreeBackedSignedBlockByFork: Record<ForkName, CreateTreeBackedSignedBlock> = {
  // Dummy placeholder Fn for phase0
  [ForkName.phase0]: ssz.phase0.SignedBeaconBlock.createTreeBackedFromStruct.bind(
    ssz.phase0.SignedBeaconBlock
  ) as CreateTreeBackedSignedBlock,
  [ForkName.altair]: ssz.altair.SignedBeaconBlock.createTreeBackedFromStruct.bind(
    ssz.altair.SignedBeaconBlock
  ) as CreateTreeBackedSignedBlock,
  [ForkName.bellatrix]: ssz.bellatrix.SignedBeaconBlock.createTreeBackedFromStruct.bind(
    ssz.bellatrix.SignedBeaconBlock
  ) as CreateTreeBackedSignedBlock,
};

export function transition(
  forkConfig: (forkEpoch: number) => Partial<IChainConfig>,
  pre: ForkName,
  fork: Exclude<ForkName, ForkName.phase0>
): void {
  describeDirectorySpecTest<ITransitionTestCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/transition`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/transition/core/pyspec_tests`),
    (testcase) => {
      const meta = testcase.meta;
      // testConfig is used here to load forkEpoch from meta.yaml
      const testConfig = createIChainForkConfig(forkConfig(bnToNum(meta.fork_epoch)));
      let wrappedState = createCachedBeaconState(testConfig, testcase.pre as TreeBacked<allForks.BeaconState>);
      for (let i = 0; i < meta.blocks_count; i++) {
        let tbSignedBlock: TreeBacked<allForks.SignedBeaconBlock>;
        if (i <= meta.fork_block) {
          const signedBlock = testcase[`blocks_${i}`] as allForks.SignedBeaconBlock;
          tbSignedBlock = createTreeBackedSignedBlockByFork[pre](signedBlock);
        } else {
          const signedBlock = testcase[`blocks_${i}`] as allForks.SignedBeaconBlock;
          tbSignedBlock = createTreeBackedSignedBlockByFork[fork](signedBlock);
        }
        wrappedState = allForks.stateTransition(wrappedState, tbSignedBlock, {
          verifyStateRoot: true,
          verifyProposer: false,
          verifySignatures: false,
        });
      }
      return wrappedState;
    },
    {
      inputTypes: inputTypeSszTreeBacked,
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
  pre: allForks.BeaconState;
  post: allForks.BeaconState;
}
