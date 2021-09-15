import fs from "fs";
import {join} from "path";
import {CachedBeaconState, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {TreeBacked, Type} from "@chainsafe/ssz";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {expectEqualBeaconState, inputTypeSszTreeBacked} from "../util";
import {IBaseSpecTest} from "../type";
import {getConfig} from "./util";

/* eslint-disable @typescript-eslint/naming-convention */

export type BlockProcessFn<BeaconState extends allForks.BeaconState> = (
  state: CachedBeaconState<BeaconState>,
  testCase: any
) => void;

export function operations<BeaconState extends allForks.BeaconState>(
  fork: ForkName,
  operationFns: Record<string, BlockProcessFn<BeaconState>>,
  sszTypes?: Record<string, Type<any>>
): void {
  const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/${fork}/operations`);
  for (const testDir of fs.readdirSync(rootDir)) {
    const operationFn = operationFns[testDir];
    if (!operationFn) {
      throw Error(`No operationFn for ${testDir}`);
    }

    describeDirectorySpecTest<IBaseSpecTest & {pre: BeaconState; post: BeaconState}, BeaconState>(
      `${ACTIVE_PRESET}/${fork}/operations/${testDir}`,
      join(rootDir, `${testDir}/pyspec_tests`),
      (testcase) => {
        const stateTB = (testcase.pre as TreeBacked<BeaconState>).clone();
        const state = allForks.createCachedBeaconState(getConfig(fork), stateTB);
        operationFn(state, testcase);
        return state;
      },
      {
        inputTypes: inputTypeSszTreeBacked,
        sszTypes: {
          pre: ssz[fork].BeaconState,
          post: ssz[fork].BeaconState,
          attestation: ssz.phase0.Attestation,
          attester_slashing: ssz.phase0.AttesterSlashing,
          block: ssz[fork].BeaconBlock,
          deposit: ssz.phase0.Deposit,
          proposer_slashing: ssz.phase0.ProposerSlashing,
          voluntary_exit: ssz.phase0.SignedVoluntaryExit,
          // Altair
          sync_aggregate: ssz.altair.SyncAggregate,
          // Provide types for new objects
          ...sszTypes,
        },
        shouldError: (testCase) => !testCase.post,
        getExpected: (testCase) => testCase.post,
        expectFunc: (testCase, expected, actual) => {
          expectEqualBeaconState(fork, expected, actual);
        },
      }
    );
  }
}
