import {join} from "path";
import {TreeBacked} from "@chainsafe/ssz";
import {CachedBeaconState, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {merge, ssz, Uint64} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {getConfig} from "./util";
import {generateBlocksSZZTypeMapping} from "./sanity";

export function finality(fork: ForkName): void {
  describeDirectorySpecTest<IFinalityTestCase, allForks.BeaconState>(
    `${ACTIVE_PRESET}/${fork}/finality/finality`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/finality/finality/pyspec_tests`),
    (testcase) => {
      let wrappedState = allForks.createCachedBeaconState(
        getConfig(fork),
        testcase.pre as TreeBacked<allForks.BeaconState>
      ) as CachedBeaconState<allForks.BeaconState>;
      const verify = testcase.meta !== undefined && testcase.meta.blsSetting === BigInt(1);
      for (let i = 0; i < Number(testcase.meta.blocksCount); i++) {
        const signedBlock = testcase[`blocks_${i}`] as merge.SignedBeaconBlock;

        wrappedState = allForks.stateTransition(
          wrappedState,
          ssz[fork].SignedBeaconBlock.createTreeBackedFromStruct(signedBlock),
          {
            verifyStateRoot: false,
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
        ...generateBlocksSZZTypeMapping(fork, 200),
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

interface IFinalityTestCase extends IBaseSpecTest {
  [k: string]: altair.SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocksCount: Uint64;
    blsSetting: BigInt;
  };
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
