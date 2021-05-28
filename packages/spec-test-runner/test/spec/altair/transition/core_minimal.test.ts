import {join} from "path";
import {expect} from "chai";
import {params} from "@chainsafe/lodestar-params/minimal";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {altair, phase0} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IBeaconConfig, createIBeaconConfig} from "@chainsafe/lodestar-config";
import {ITransitionTestCase} from "./types";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {TreeBacked} from "@chainsafe/ssz";

// eslint-disable-next-line @typescript-eslint/naming-convention
const config = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: 0});

describeDirectorySpecTest<ITransitionTestCase, allForks.BeaconState>(
  "altair transition minimal",
  join(SPEC_TEST_LOCATION, "/tests/minimal/altair/transition/core/pyspec_tests"),
  (testcase) => {
    const meta = testcase.meta;
    const {forkEpoch, blocksCount, forkBlock} = meta;
    // testConfig is used here to load forkEpoch from meta.yaml
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const testConfig = createIBeaconConfig({...params, ALTAIR_FORK_EPOCH: Number(forkEpoch)});
    let wrappedState = allForks.createCachedBeaconState<allForks.BeaconState>(
      testConfig,
      testcase.pre as TreeBacked<allForks.BeaconState>
    );
    for (let i = 0; i < Number(blocksCount); i++) {
      let tbSignedBlock: allForks.SignedBeaconBlock;
      if (i <= forkBlock) {
        const signedBlock = testcase[`blocks_${i}`] as phase0.SignedBeaconBlock;
        tbSignedBlock = testConfig.types.phase0.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock);
      } else {
        const signedBlock = testcase[`blocks_${i}`] as altair.SignedBeaconBlock;
        tbSignedBlock = testConfig.types.altair.SignedBeaconBlock.createTreeBackedFromStruct(signedBlock);
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
        pre: config.types.phase0.BeaconState,
        post: config.types.altair.BeaconState,
        ...generateBlocksSZZTypeMapping(config, meta),
      };
    },
    shouldError: (testCase) => {
      return !testCase.post;
    },
    timeout: 10000000,
    getExpected: (testCase) => testCase.post,
    expectFunc: (testCase, expected, actual) => {
      expect(config.types.altair.BeaconState.equals(actual, expected)).to.be.true;
    },
  }
);

/**
 * https://github.com/ethereum/eth2.0-specs/tree/v1.1.0-alpha.5/tests/formats/transition
 */
function generateBlocksSZZTypeMapping(
  config: IBeaconConfig,
  meta: ITransitionTestCase["meta"]
): Record<string, typeof config.types.phase0.SignedBeaconBlock | typeof config.types.altair.SignedBeaconBlock> {
  if (!meta) {
    throw new Error("No meta data found");
  }
  const blocksMapping: Record<
    string,
    typeof config.types.phase0.SignedBeaconBlock | typeof config.types.altair.SignedBeaconBlock
  > = {};
  // The fork_block is the index in the test data of the last block of the initial fork.
  for (let i = 0; i < meta.blocksCount; i++) {
    blocksMapping[`blocks_${i}`] =
      i <= meta.forkBlock ? config.types.phase0.SignedBeaconBlock : config.types.altair.SignedBeaconBlock;
  }
  return blocksMapping;
}
