import path from "node:path";
import {expect} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ACTIVE_PRESET} from "@lodestar/params";
import {BeaconStateAllForks, CachedBeaconStateEip8453} from "@lodestar/state-transition";
import * as epochFns from "@lodestar/state-transition/epoch";
import {ssz} from "@lodestar/types";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";

/**
 * EIP-8453 round processing: `process_round` runs at round boundaries and its sub-transitions are tested
 * individually, like epoch processing. Format: tests/formats/round_processing/README.md on the compliance
 * generator branch (ericsson49/eth2.0-specs codex/eip8453-comptests).
 */
type RoundTransitionFn = (state: CachedBeaconStateEip8453) => void;

const roundTransitionFns: Record<string, RoundTransitionFn> = {
  inactivity_updates: (state) => epochFns.processInactivityUpdatesEip8453(state, state.roundParticipation.getAll()),
  rewards: (state) => epochFns.processRewardsEip8453(state, state.roundParticipation.getAll()),
  participation_flag_updates: (state) => epochFns.processParticipationFlagUpdatesEip8453(state),
};

type RoundProcessingTestCase = {
  meta?: {bls_setting?: bigint};
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
  /** Optional: the state before the whole round transition, absent when `pre` was mutated in between */
  pre_round?: BeaconStateAllForks;
  /** Optional: the state after the whole round transition, absent (with `pre_round` present) when it aborts */
  post_round?: BeaconStateAllForks;
};

const roundProcessing: TestRunnerFn<RoundProcessingTestCase, BeaconStateAllForks> = (fork, testName) => {
  const config = getConfig(fork);

  const roundTransitionFn = roundTransitionFns[testName];
  if (roundTransitionFn === undefined) {
    throw Error(`No roundTransitionFn for ${testName}`);
  }

  return {
    testFunction: (testcase) => {
      // Alternative condition: the whole round transition must also reproduce `post_round` from `pre_round`
      if (testcase.pre_round !== undefined) {
        const roundState = createCachedBeaconStateTest(testcase.pre_round.clone(), config, {
          lenient: true,
        }) as CachedBeaconStateEip8453;
        if (testcase.post_round === undefined) {
          expect(() => epochFns.processRound(roundState)).toThrow();
        } else {
          epochFns.processRound(roundState);
          roundState.commit();
          expectEqualBeaconState(fork, testcase.post_round, roundState);
        }
      }

      const state = createCachedBeaconStateTest(testcase.pre.clone(), config, {
        lenient: true,
      }) as CachedBeaconStateEip8453;
      if (testcase.post === undefined) {
        // An absent post state requires the sub-transition to abort
        expect(() => roundTransitionFn(state)).toThrow();
      } else {
        roundTransitionFn(state);
      }
      state.commit();
      return state;
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        pre_round: ssz[fork].BeaconState,
        post_round: ssz[fork].BeaconState,
      },
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        if (expected === undefined) {
          return;
        }
        expectEqualBeaconState(fork, expected, actual);
      },
    },
  };
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  round_processing: {type: RunnerType.default, fn: roundProcessing},
});
