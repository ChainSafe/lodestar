import fs from "node:fs";
import path from "node:path";
import {beforeEach, describe, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ForkName} from "@lodestar/params";
import {describeDirectorySpecTest} from "@lodestar/spec-test-util";
import {RunnerType, TestRunner} from "./types.js";

const ARTIFACT_FILENAMES = new Set([
  // MacOS artifacts
  "._.DS_Store",
  ".DS_Store",
  // File included by spec tests downloader
  "version.txt",
]);

export interface SkipOpts {
  skippedTestSuites?: RegExp[];
  skippedTests?: RegExp[];
  skippedForks?: string[];
  skippedRunners?: string[];
  skippedHandlers?: string[];
}

/**
 * Because we want to execute the spec tests in parallel so one or two runners will be executed
 * in isolation at a time and would not be available how many runners are there in total.
 * This list is curated manually and should be updated when new runners are added.
 * It will make sure if specs introduce new runner, we should cover in our spec tests.
 */
const coveredTestRunners = [
  "light_client",
  "epoch_processing",
  "fast_confirmation",
  "finality",
  "fork",
  "fork_choice",
  "fork_choice_compliance",
  "sync",
  "fork",
  "genesis",
  "merkle_proof",
  "networking",
  "operations",
  "rewards",
  "sanity",
  "random",
  "shuffling",
  "ssz_static",
  "transition",
];

/**
 * Build a `skippedTests` matcher for the listed gloas `fork_choice_compliance` test cases.
 */
function gloasComptestCases(testCases: string[]): RegExp {
  return new RegExp(`^gloas/fork_choice_compliance/[^/]+/pyspec_tests/(${testCases.join("|")})$`);
}

// TODO-GLOAS: re-enable once https://github.com/ethereum/consensus-specs/issues/5496 is resolved.
// The `viable_for_head_roots_and_weights` check walks `get_node_children()` over
// `get_filtered_block_tree()` from the justified checkpoint and collects every childless node.
// `filter_block_tree` only applies the FFG viability test to blocks that have no children, so a
// block kept in the tree because one of its descendant branches is viable still contributes its
// EMPTY/FULL variants as leaves. Lodestar instead applies `nodeIsViableForHead` to every candidate
// leaf and drops those variants.
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/phase0/fork-choice.md#filter_block_tree
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/gloas/fork-choice.md#modified-get_node_children
const gloasComptestViableHeadLeaves = [
  "attester_slashing_test_0_995132683_1",
  "attester_slashing_test_0_995132683_2",
  "attester_slashing_test_0_995132683_3",
  "attester_slashing_test_1_969067138_3",
  "attester_slashing_test_3_678331942_1",
  "attester_slashing_test_3_678331942_3",
  "block_tree_test_0_188997410_1",
  "block_tree_test_102_277585874_1",
  "block_tree_test_106_120242536_1",
  "block_tree_test_107_512824342_1",
  "block_tree_test_108_928458476_1",
  "block_tree_test_10_129994044_1",
  "block_tree_test_10_726975977_0",
  "block_tree_test_10_726975977_1",
  "block_tree_test_110_588920179_1",
  "block_tree_test_113_619819453_1",
  "block_tree_test_115_397940262_1",
  "block_tree_test_115_412207408_1",
  "block_tree_test_116_1551850_1",
  "block_tree_test_11_590833808_1",
  "block_tree_test_11_736740354_0",
  "block_tree_test_11_736740354_1",
  "block_tree_test_12_568322552_1",
  "block_tree_test_12_647714550_0",
  "block_tree_test_12_647714550_1",
  "block_tree_test_13_487036634_0",
  "block_tree_test_13_487036634_1",
  "block_tree_test_14_613352269_0",
  "block_tree_test_14_613352269_1",
  "block_tree_test_14_800178261_0",
  "block_tree_test_14_800178261_1",
  "block_tree_test_15_688406465_0",
  "block_tree_test_15_688406465_1",
  "block_tree_test_15_781661794_0",
  "block_tree_test_15_781661794_1",
  "block_tree_test_16_912444108_1",
  "block_tree_test_16_990975446_1",
  "block_tree_test_17_445229607_1",
  "block_tree_test_17_548432409_0",
  "block_tree_test_17_548432409_1",
  "block_tree_test_18_728354765_0",
  "block_tree_test_18_728354765_1",
  "block_tree_test_18_896864151_1",
  "block_tree_test_19_253587584_1",
  "block_tree_test_19_601151281_1",
  "block_tree_test_1_215729744_0",
  "block_tree_test_1_215729744_1",
  "block_tree_test_1_251475480_1",
  "block_tree_test_20_214997470_1",
  "block_tree_test_20_432327100_0",
  "block_tree_test_20_432327100_1",
  "block_tree_test_21_526621697_1",
  "block_tree_test_21_81952788_0",
  "block_tree_test_21_81952788_1",
  "block_tree_test_22_143950986_1",
  "block_tree_test_22_745280184_1",
  "block_tree_test_23_170883060_0",
  "block_tree_test_23_170883060_1",
  "block_tree_test_23_931833277_1",
  "block_tree_test_24_160127814_1",
  "block_tree_test_24_829641259_0",
  "block_tree_test_24_829641259_1",
  "block_tree_test_25_712156366_0",
  "block_tree_test_25_712156366_1",
  "block_tree_test_25_741498237_0",
  "block_tree_test_25_741498237_1",
  "block_tree_test_26_679076983_1",
  "block_tree_test_26_88674323_1",
  "block_tree_test_27_611786968_1",
  "block_tree_test_27_832843048_1",
  "block_tree_test_28_19172131_1",
  "block_tree_test_28_659949852_1",
  "block_tree_test_29_321605832_1",
  "block_tree_test_29_521409727_1",
  "block_tree_test_2_408467282_0",
  "block_tree_test_2_408467282_1",
  "block_tree_test_2_852421743_0",
  "block_tree_test_2_852421743_1",
  "block_tree_test_30_368829725_0",
  "block_tree_test_30_368829725_1",
  "block_tree_test_30_742315573_0",
  "block_tree_test_30_742315573_1",
  "block_tree_test_31_147160936_1",
  "block_tree_test_31_705368485_0",
  "block_tree_test_31_705368485_1",
  "block_tree_test_3_124386458_0",
  "block_tree_test_3_124386458_1",
  "block_tree_test_3_132278652_0",
  "block_tree_test_3_132278652_1",
  "block_tree_test_4_627865675_0",
  "block_tree_test_4_627865675_1",
  "block_tree_test_4_77897924_0",
  "block_tree_test_4_77897924_1",
  "block_tree_test_5_18082863_1",
  "block_tree_test_5_577493828_1",
  "block_tree_test_6_157025781_1",
  "block_tree_test_6_729160438_0",
  "block_tree_test_6_729160438_1",
  "block_tree_test_7_696317701_1",
  "block_tree_test_7_849016127_0",
  "block_tree_test_7_849016127_1",
  "block_tree_test_88_319894679_1",
  "block_tree_test_89_584612141_1",
  "block_tree_test_8_171828947_1",
  "block_tree_test_8_27266272_1",
  "block_tree_test_91_325281615_1",
  "block_tree_test_9_996101869_1",
  "block_weight_test_0_574194858_1",
  "block_weight_test_1_42593438_1",
  "block_weight_test_2_113600423_1",
  "block_weight_test_2_885402139_1",
  "block_weight_test_3_218910755_1",
  "block_weight_test_3_533596115_1",
  "invalid_message_test_0_576282072_1",
  "invalid_message_test_1_998506105_1",
  "invalid_message_test_2_572811149_1",
  "shuffling_test_2_307707215_1",
  "shuffling_test_2_307707215_10",
  "shuffling_test_2_307707215_11",
  "shuffling_test_2_307707215_13",
  "shuffling_test_2_307707215_14",
  "shuffling_test_2_307707215_21",
  "shuffling_test_2_307707215_23",
  "shuffling_test_2_307707215_27",
  "shuffling_test_2_307707215_3",
  "shuffling_test_2_307707215_4",
  "shuffling_test_2_307707215_5",
];

// NOTE: You MUST always provide a detailed reason of why a spec test is skipped plus link
// to an issue marking it as pending to re-enable and an aproximate timeline of when it will
// be fixed.
// NOTE: Comment the minimum set of test necessary to unblock PRs: For example, instead of
// skipping all `bls_to_execution_change` tests, just skip for a fork setting:
// ```
// skippedPrefixes: [
//    // Skipped since this only test that withdrawals are de-activated
//    "eip4844/operations/bls_to_execution_change",
// ],
// ```
export const defaultSkipOpts: SkipOpts = {
  skippedForks: ["eip8148"],
  skippedTestSuites: [
    // Merge transition tests are skipped because we no longer support performing the merge transition.
    // All networks have already completed the merge, so this code path is no longer needed.
    /^bellatrix\/fork_choice\/on_merge_block\/.*/,
    // TODO: capella
    // BeaconBlockBody proof in lightclient is the new addition in v1.3.0-rc.2-hotfix
    // Skip them for now to enable subsequently
    /^capella\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
    /^deneb\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
    /^electra\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
    /^fulu\/light_client\/single_merkle_proof\/BeaconBlockBody.*/,
    /^.+\/light_client\/data_collection\/.*/,
    // Ignore the partial data column container additions for now. Unskip them when
    // cell level DAS is ready
    /^fulu\/ssz_static\/PartialDataColumn(GroupID|Header|PartsMetadata|Sidecar)\/.*$/,
    /^gloas\/ssz_static\/PartialDataColumn(GroupID|PartsMetadata|Sidecar)\/.*$/,
    /^heze\/ssz_static\/PartialDataColumn(GroupID|PartsMetadata|Sidecar)\/.*$/,
    // TODO-GLOAS: re-enable after Gloas light-client sync deserializes updates by fork digest.
    /^gloas\/light_client\/sync\/.*/,
    /^heze\/light_client\/sync\/.*/,
    // TODO-GLOAS: re-enable after on_payload_attestation_message (PTC) fork choice is implemented.
    // New test suite added in v1.7.0-alpha.8 (consensus-specs #5206); gloas PTC fork choice
    // handling is not yet implemented in Lodestar.
    /^gloas\/fork_choice\/on_payload_attestation_message\/.*$/,
    /^heze\/fork_choice\/on_payload_attestation_message\/.*$/,
    // TODO-HEZE: enable this after heze fork choice is ready
    /^heze\/fork_choice_compliance\/.*/,
    // TODO-HEZE: re-enable after on_inclusion_list (FOCIL) fork choice is implemented.
    /^heze\/fork_choice\/on_inclusion_list\/.*$/,
  ],
  skippedTests: [
    // TODO-GLOAS: re-enable after gloas light client is implemented
    /\/gloas_fork$/,
    /\/heze_fork$/,
    // TODO GLOAS: gloas/heze take ~23-24s on the mainnet preset (~7.5x pre-gloas) because every
    // post-gloas slot writes into the SLOTS_PER_HISTORICAL_ROOT-wide executionPayloadAvailability
    // bitvector, and this suite steps 8192 slots. That is 76-81% of the 30s sanity/slots timeout,
    // so skip rather than raise the timeout and hide the regression.
    // Enable this after https://github.com/ChainSafe/lodestar/issues/9771 is resolved
    /^(gloas|heze)\/sanity\/slots\/pyspec_tests\/historical_accumulator$/,
    gloasComptestCases(gloasComptestViableHeadLeaves),
  ],
  // TODO GLOAS: Investigate why networking tests are failing since alpha.5
  skippedRunners: ["networking"],
};

/**
 * This helper ensures that strictly all tests are run. There's no hardcoded value beyond "config".
 * Any additional unknown fork, testRunner, testHandler, or testSuite will result in an error.
 *
 * File path structure:
 * ```
 * tests/
 *   <config name>/                     [general, mainnet, minimal]
 *     <fork or phase name>/            [phase0, altair, bellatrix]
 *       <test runner name>/            [bls, ssz_static, fork]
 *         <test handler name>/         ...
 *           <test suite name>/
 *             <test case>/<output part>
 * ```
 *
 * Examples
 * ```
 *       / config  / fork   / test runner      / test handler / test suite   / test case
 *
 * tests / general / phase0 / bls              / aggregate    / small        / aggregate_na_signatures/data.yaml
 * tests / mainnet / altair / ssz_static       / Validator    / ssz_random   / case_0/roots.yaml
 * tests / mainnet / altair / fork             / fork         / pyspec_tests / altair_fork_random_0/meta.yaml
 * ```
 * Ref: https://github.com/ethereum/consensus-specs/blob/v1.6.1/tests/formats/README.md#test-structure
 */
export function specTestIterator(
  configDirpath: string,
  testRunners: Record<string, TestRunner>,
  opts: SkipOpts = defaultSkipOpts
): void {
  for (const forkStr of readdirSyncSpec(configDirpath)) {
    if (
      opts?.skippedForks?.includes(forkStr) ||
      (process.env.SPEC_FILTER_FORK && forkStr !== process.env.SPEC_FILTER_FORK)
    ) {
      continue;
    }
    const fork = forkStr as ForkName;

    const forkDirpath = path.join(configDirpath, forkStr);
    for (const testRunnerName of readdirSyncSpec(forkDirpath)) {
      if (opts?.skippedRunners?.includes(testRunnerName)) {
        continue;
      }

      const testRunnerDirpath = path.join(forkDirpath, testRunnerName);
      const testRunner = testRunners[testRunnerName];

      if (testRunner === undefined && coveredTestRunners.includes(testRunnerName)) {
        // That runner is not part of the current call to specTestIterator
        continue;
      }

      if (testRunner === undefined && !coveredTestRunners.includes(testRunnerName)) {
        throw new Error(
          `No test runner for ${testRunnerName}. Please make sure it is covered in "coveredTestRunners" if you added new runner.`
        );
      }

      for (const testHandler of readdirSyncSpec(testRunnerDirpath)) {
        if (opts?.skippedHandlers?.includes(testHandler)) {
          continue;
        }

        const testHandlerDirpath = path.join(testRunnerDirpath, testHandler);
        for (const testSuite of readdirSyncSpec(testHandlerDirpath)) {
          const testId = `${fork}/${testRunnerName}/${testHandler}/${testSuite}`;

          if (opts?.skippedTestSuites?.some((skippedMatch) => testId.match(skippedMatch))) {
            displaySkipTest(testId);
          } else if (fork === undefined) {
            displayFailTest(testId, `Unknown fork ${forkStr}`);
          } else {
            const testSuiteDirpath = path.join(testHandlerDirpath, testSuite);
            // Specific logic for ssz_static since it has one extra level of directories
            if (testRunner.type === RunnerType.custom) {
              describe(testId, () => {
                beforeEach(() => pubkeyCache.reset());
                testRunner.fn(fork, testHandler, testSuite, testSuiteDirpath);
              });
            }

            // Generic testRunner
            else {
              const {testFunction, options} = testRunner.fn(fork, testHandler, testSuite);
              if (opts.skippedTests) {
                // Compose with any runner-local shouldSkip — overwriting it would silently
                // disable SkipOpts.skippedTests for runners that define their own (fork_choice).
                const runnerShouldSkip = options.shouldSkip;
                options.shouldSkip = (testCase: any, name: string, index: number): boolean => {
                  return (
                    (runnerShouldSkip?.(testCase, name, index) ?? false) ||
                    (opts.skippedTests?.some((skippedMatch) => name.match(skippedMatch)) ?? false)
                  );
                };
              }
              describeDirectorySpecTest(
                testId,
                testSuiteDirpath,
                (testCase, directoryName, testCaseName) => {
                  pubkeyCache.reset();
                  return testFunction(testCase, directoryName, testCaseName);
                },
                options
              );
            }
          }
        }
      }
    }
  }
}

function displayFailTest(testId: string, msg: string): void {
  describe(testId, () => {
    it(testId, () => {
      throw Error(msg);
    });
  });
}

function displaySkipTest(testId: string): void {
  describe(testId, () => {
    it.skip(testId, () => {
      //
    });
  });
}

export function readdirSyncSpec(dirpath: string): string[] {
  const files = fs.readdirSync(dirpath);
  return files.filter((file) => !ARTIFACT_FILENAMES.has(file));
}
