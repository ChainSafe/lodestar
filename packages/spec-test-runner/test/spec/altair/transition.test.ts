import {join} from "path";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {altair, phase0, Uint64, Epoch, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {ForkName, ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {TreeBacked} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";

describeDirectorySpecTest<ITransitionTestCase, allForks.BeaconState>(
  `${ACTIVE_PRESET}/altair/transition`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/altair/transition/core/pyspec_tests`),
  (testcase) => {
    const meta = testcase.meta;
    const {forkEpoch, blocksCount, forkBlock} = meta;
    // testConfig is used here to load forkEpoch from meta.yaml
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const testConfig = createIChainForkConfig({ALTAIR_FORK_EPOCH: Number(forkEpoch)});
    let wrappedState = allForks.createCachedBeaconState<allForks.BeaconState>(
      testConfig,
      testcase.pre as TreeBacked<allForks.BeaconState>
    );
    for (let i = 0; i < Number(blocksCount); i++) {
      let tbSignedBlock: allForks.SignedBeaconBlock;
      if (i <= forkBlock) {
        const signedBlock = testcase[`blocks_${i}`] as phase0.SignedBeaconBlock;
        tbSignedBlock = ssz.phase0.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock);
      } else {
        const signedBlock = testcase[`blocks_${i}`] as altair.SignedBeaconBlock;
        tbSignedBlock = ssz.altair.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock);
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
        pre: ssz.phase0.BeaconState,
        post: ssz.altair.BeaconState,
        ...generateBlocksSZZTypeMapping(meta),
      };
    },
    shouldError: (testCase) => testCase.post === undefined,
    timeout: 10000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expectEqualBeaconState(ForkName.altair, expected, actual);
    },
  }
);

type BlocksSZZTypeMapping = Record<string, typeof ssz[ForkName]["SignedBeaconBlock"]>;

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
    blocksMapping[`blocks_${i}`] = i <= meta.forkBlock ? ssz.phase0.SignedBeaconBlock : ssz.altair.SignedBeaconBlock;
  }
  return blocksMapping;
}

interface ITransitionTestCase extends IBaseSpecTest {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    postFork: ForkName;
    forkEpoch: Epoch;
    forkBlock: Uint64;
    blocksCount: Uint64;
    blsSetting?: BigInt;
  };
  pre: phase0.BeaconState;
  post: altair.BeaconState;
}
