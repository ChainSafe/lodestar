import {join} from "path";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {altair, phase0, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {ITransitionTestCase} from "./types";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {TreeBacked} from "@chainsafe/ssz";
import {expectEqualBeaconStateAltair} from "../../util";
import {PresetName} from "@chainsafe/lodestar-params";

export function runTransition(presetName: PresetName): void {
  describeDirectorySpecTest<ITransitionTestCase, allForks.BeaconState>(
    `altair transition ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/transition/core/pyspec_tests`),
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
      getSszTypes: (meta: ITransitionTestCase["meta"]) => {
        return {
          pre: ssz.phase0.BeaconState,
          post: ssz.altair.BeaconState,
          ...generateBlocksSZZTypeMapping(meta),
        };
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
}

/**
 * https://github.com/ethereum/eth2.0-specs/tree/v1.1.0-alpha.5/tests/formats/transition
 */
function generateBlocksSZZTypeMapping(
  meta: ITransitionTestCase["meta"]
): Record<string, typeof ssz.phase0.SignedBeaconBlock | typeof ssz.altair.SignedBeaconBlock> {
  if (!meta) {
    throw new Error("No meta data found");
  }
  const blocksMapping: Record<string, typeof ssz.phase0.SignedBeaconBlock | typeof ssz.altair.SignedBeaconBlock> = {};
  // The fork_block is the index in the test data of the last block of the initial fork.
  for (let i = 0; i < meta.blocksCount; i++) {
    blocksMapping[`blocks_${i}`] = i <= meta.forkBlock ? ssz.phase0.SignedBeaconBlock : ssz.altair.SignedBeaconBlock;
  }
  return blocksMapping;
}
