import fs from "node:fs";
import {join} from "node:path";
import {BeaconStateAllForks, CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../util";
import {IBaseSpecTest} from "../type";
import {getConfig} from "./util";

/* eslint-disable @typescript-eslint/naming-convention */

export type BlockProcessFn<T extends CachedBeaconStateAllForks> = (state: T, testCase: any) => void;

export type OperationsTestCase = IBaseSpecTest & {
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
  execution: {execution_valid: boolean};
};

export function operations<T extends CachedBeaconStateAllForks>(
  fork: ForkName,
  operationFns: Record<string, BlockProcessFn<T>>,
  sszTypes?: Record<string, Type<any>>
): void {
  const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/${fork}/operations`);
  const testDirs = fs
    .readdirSync(rootDir, {withFileTypes: true})
    // Ignore the .DS_Store and ._.DS_Store artificat files by filtering directories
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);
  for (const testDir of testDirs) {
    const operationFn = operationFns[testDir];
    if (operationFn === undefined) {
      throw Error(`No operationFn for ${testDir}`);
    }

    describeDirectorySpecTest<OperationsTestCase, BeaconStateAllForks>(
      `${ACTIVE_PRESET}/${fork}/operations/${testDir}`,
      join(rootDir, `${testDir}/pyspec_tests`),
      (testcase) => {
        const state = testcase.pre.clone();
        const cachedState = createCachedBeaconStateTest(state, getConfig(fork));
        operationFn(cachedState as T, testcase);
        state.commit();
        return state;
      },
      {
        inputTypes: {...inputTypeSszTreeViewDU, execution: InputType.YAML},
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
          // Bellatrix
          execution_payload: ssz.bellatrix.ExecutionPayload,
          // Provide types for new objects
          ...sszTypes,
        },
        shouldError: (testCase) => testCase.post === undefined,
        getExpected: (testCase) => testCase.post,
        expectFunc: (testCase, expected, actual) => {
          expectEqualBeaconState(fork, expected, actual);
        },
      }
    );
  }
}
