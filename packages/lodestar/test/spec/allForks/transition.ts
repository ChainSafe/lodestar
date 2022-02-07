import {join} from "node:path";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {Uint64, Epoch, ssz, phase0, altair, bellatrix} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {ForkName, ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {TreeBacked} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";

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
  describeDirectorySpecTest<ITransitionTestCase, PostBeaconState>(
    `${ACTIVE_PRESET}/${fork}/transition`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/transition/core/pyspec_tests`),
    (testcase) => {
      const meta = testcase.meta;
      const {forkEpoch, blocksCount, forkBlock} = meta;
      // testConfig is used here to load forkEpoch from meta.yaml
      const testConfig = createIChainForkConfig(forkConfig(Number(forkEpoch)));
      let wrappedState = allForks.createCachedBeaconState(testConfig, testcase.pre as TreeBacked<allForks.BeaconState>);
      for (let i = 0; i < Number(blocksCount); i++) {
        let tbSignedBlock: TreeBacked<allForks.SignedBeaconBlock>;
        if (i <= forkBlock) {
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
    for (let i = 0; i < meta.blocksCount; i++) {
      blocksMapping[`blocks_${i}`] = i <= meta.forkBlock ? ssz[pre].SignedBeaconBlock : ssz[fork].SignedBeaconBlock;
    }
    return blocksMapping;
  }
}

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;
type PostBeaconState = Exclude<allForks.BeaconState, phase0.BeaconState>;

interface ITransitionTestCase extends IBaseSpecTest {
  [k: string]:
    | phase0.SignedBeaconBlock
    | altair.SignedBeaconBlock
    | bellatrix.SignedBeaconBlock
    | unknown
    | null
    | undefined;
  meta: {
    postFork: ForkName;
    forkEpoch: Epoch;
    forkBlock: Uint64;
    blocksCount: Uint64;
    blsSetting?: BigInt;
  };
  pre: allForks.BeaconState;
  post: PostBeaconState;
}
