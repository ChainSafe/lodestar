import fs from "node:fs";
import path from "node:path";
import {describe, it} from "vitest";
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
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/phase0/fork-choice.md#filter_block_tree
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/gloas/fork-choice.md#modified-get_node_children
const gloasComptestViableHeadLeaves = [
  "attester_slashing_test_0_226588189_1",
  "attester_slashing_test_0_226588189_2",
  "attester_slashing_test_0_226588189_3",
  "attester_slashing_test_2_421093739_2",
  "attester_slashing_test_2_421093739_3",
  "block_tree_test_0_352637865_1",
  "block_tree_test_0_845778111_1",
  "block_tree_test_106_185181652_1",
  "block_tree_test_10_66748590_0",
  "block_tree_test_10_66748590_1",
  "block_tree_test_113_104835152_1",
  "block_tree_test_114_556894271_1",
  "block_tree_test_115_240136365_1",
  "block_tree_test_11_871030299_1",
  "block_tree_test_11_928674675_0",
  "block_tree_test_11_928674675_1",
  "block_tree_test_120_210881607_1",
  "block_tree_test_12_261128873_1",
  "block_tree_test_13_840768473_1",
  "block_tree_test_13_955768526_0",
  "block_tree_test_13_955768526_1",
  "block_tree_test_14_184936772_1",
  "block_tree_test_14_351319602_0",
  "block_tree_test_14_351319602_1",
  "block_tree_test_15_541038344_0",
  "block_tree_test_15_541038344_1",
  "block_tree_test_15_800019884_1",
  "block_tree_test_16_992154782_1",
  "block_tree_test_17_297549237_0",
  "block_tree_test_17_297549237_1",
  "block_tree_test_17_833975407_1",
  "block_tree_test_18_653198546_1",
  "block_tree_test_19_59463747_1",
  "block_tree_test_19_94131960_0",
  "block_tree_test_19_94131960_1",
  "block_tree_test_1_27790366_1",
  "block_tree_test_1_319877891_1",
  "block_tree_test_20_214924340_0",
  "block_tree_test_20_214924340_1",
  "block_tree_test_20_745066523_0",
  "block_tree_test_20_745066523_1",
  "block_tree_test_21_172273850_0",
  "block_tree_test_21_172273850_1",
  "block_tree_test_21_922545239_0",
  "block_tree_test_21_922545239_1",
  "block_tree_test_22_25875870_1",
  "block_tree_test_23_389844694_0",
  "block_tree_test_23_389844694_1",
  "block_tree_test_23_596961007_1",
  "block_tree_test_24_354496613_1",
  "block_tree_test_24_880236990_1",
  "block_tree_test_25_107974445_0",
  "block_tree_test_25_107974445_1",
  "block_tree_test_25_627240016_1",
  "block_tree_test_26_142042261_1",
  "block_tree_test_26_173072614_1",
  "block_tree_test_27_913292592_0",
  "block_tree_test_27_913292592_1",
  "block_tree_test_28_381675110_0",
  "block_tree_test_28_381675110_1",
  "block_tree_test_28_807978456_1",
  "block_tree_test_29_814589308_0",
  "block_tree_test_29_814589308_1",
  "block_tree_test_29_983211062_1",
  "block_tree_test_2_157312094_1",
  "block_tree_test_2_936376354_1",
  "block_tree_test_30_436259754_1",
  "block_tree_test_30_644382087_0",
  "block_tree_test_30_644382087_1",
  "block_tree_test_31_546039503_1",
  "block_tree_test_3_232637041_1",
  "block_tree_test_3_747971273_1",
  "block_tree_test_4_159122318_0",
  "block_tree_test_4_159122318_1",
  "block_tree_test_4_291003728_1",
  "block_tree_test_59_780026018_1",
  "block_tree_test_5_775147857_1",
  "block_tree_test_69_476868810_1",
  "block_tree_test_6_209849067_0",
  "block_tree_test_6_209849067_1",
  "block_tree_test_6_541786653_1",
  "block_tree_test_7_202782845_1",
  "block_tree_test_7_493637508_1",
  "block_tree_test_83_14604737_1",
  "block_tree_test_84_422061595_1",
  "block_tree_test_85_960869476_1",
  "block_tree_test_8_873901914_1",
  "block_tree_test_8_932531002_1",
  "block_tree_test_92_398510864_1",
  "block_tree_test_93_111283980_1",
  "block_tree_test_9_292085981_1",
  "block_tree_test_9_30034874_1",
  "block_weight_test_0_166333364_1",
  "block_weight_test_0_532005829_1",
  "block_weight_test_1_488626664_1",
  "block_weight_test_1_911829335_1",
  "block_weight_test_2_631708459_1",
  "block_weight_test_3_182495513_1",
  "shuffling_test_0_666671982_10",
  "shuffling_test_0_666671982_12",
  "shuffling_test_0_666671982_14",
  "shuffling_test_0_666671982_15",
  "shuffling_test_0_666671982_16",
  "shuffling_test_0_666671982_17",
  "shuffling_test_0_666671982_2",
  "shuffling_test_0_666671982_21",
  "shuffling_test_0_666671982_22",
  "shuffling_test_0_666671982_24",
  "shuffling_test_0_666671982_25",
  "shuffling_test_0_666671982_3",
  "shuffling_test_0_666671982_30",
  "shuffling_test_0_666671982_31",
  "shuffling_test_0_666671982_4",
  "shuffling_test_0_666671982_5",
  "shuffling_test_0_666671982_8",
  "shuffling_test_2_356827824_1",
  "shuffling_test_2_356827824_11",
  "shuffling_test_2_356827824_14",
  "shuffling_test_2_356827824_15",
  "shuffling_test_2_356827824_16",
  "shuffling_test_2_356827824_18",
  "shuffling_test_2_356827824_19",
  "shuffling_test_2_356827824_2",
  "shuffling_test_2_356827824_20",
  "shuffling_test_2_356827824_21",
  "shuffling_test_2_356827824_22",
  "shuffling_test_2_356827824_24",
  "shuffling_test_2_356827824_26",
  "shuffling_test_2_356827824_28",
  "shuffling_test_2_356827824_29",
  "shuffling_test_2_356827824_3",
  "shuffling_test_2_356827824_6",
  "shuffling_test_2_356827824_7",
  "shuffling_test_2_356827824_8",
];

// TODO-GLOAS: re-enable after https://github.com/ChainSafe/lodestar/issues/9694 is resolved.
// Proposer boost weight is quantized to EFFECTIVE_BALANCE_INCREMENT units twice, losing 0.4 ETH.
const gloasComptestProposerBoostWeight = [
  "block_cover_test_10_10847276_0",
  "block_cover_test_10_285816524_0",
  "block_cover_test_11_777526595_0",
  "block_cover_test_11_781015092_0",
  "block_cover_test_1_580012143_0",
  "block_cover_test_1_986683414_0",
  "block_cover_test_2_753766902_0",
  "block_cover_test_2_84743119_0",
  "block_cover_test_3_52660823_0",
  "block_cover_test_3_886497517_0",
  "block_cover_test_9_137066894_0",
  "block_cover_test_9_863436416_0",
];

// TODO-GLOAS: re-enable once https://github.com/ethereum/consensus-specs/pull/5495 lands and the
// spec pin includes it. The vector imports the same block twice. `on_block` unconditionally resets
// `payload_timeliness_vote` / `payload_data_availability_vote` for the block root, which flips
// `should_extend_payload` and moves the head; Lodestar rejects the second import as ALREADY_KNOWN
// and keeps the PTC votes.
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/gloas/fork-choice.md#modified-on_block
const gloasComptestDuplicateBlockImport = ["block_tree_test_80_27150368_1"];

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
  skippedForks: ["eip7805", "heze"],
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
    // TODO-GLOAS: re-enable after Gloas light-client sync deserializes updates by fork digest.
    /^gloas\/light_client\/sync\/.*/,
    // TODO-GLOAS: re-enable after on_payload_attestation_message (PTC) fork choice is implemented.
    // New test suite added in v1.7.0-alpha.8 (consensus-specs #5206); gloas PTC fork choice
    // handling is not yet implemented in Lodestar.
    /^gloas\/fork_choice\/on_payload_attestation_message\/.*$/,
    // TODO-GLOAS: re-enable after the gloas should_apply_proposer_boost rule is implemented.
    // New test suite added in v1.7.0-alpha.13 (consensus-specs #5441); Lodestar still applies
    // the pre-gloas proposer boost, so the head weight differs by the boost amount.
    /^gloas\/fork_choice\/should_apply_proposer_boost\/.*$/,
  ],
  skippedTests: [
    // TODO-GLOAS: re-enable after gloas light client is implemented
    /\/gloas_fork$/,
    // TODO GLOAS: Proposer-boost dependent-root gate uses stale cached head across epoch-boundary ticks;
    // boost wrongly denied. Fails identically on every pre-gloas fork.
    // Enable this after https://github.com/ChainSafe/lodestar/issues/9666 is resolved
    // The case name embeds the generation seed, so it changes whenever comptests are regenerated.
    /fork_choice_compliance\/block_tree_test\/pyspec_tests\/block_tree_test_17_381675768_1$/,
    gloasComptestCases(gloasComptestViableHeadLeaves),
    gloasComptestCases(gloasComptestProposerBoostWeight),
    gloasComptestCases(gloasComptestDuplicateBlockImport),
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
 * tests / general / phase0 / ssz_generic      / basic_vector / valid        / vec_bool_1_max/meta.yaml
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
              describeDirectorySpecTest(testId, testSuiteDirpath, testFunction, options);
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
