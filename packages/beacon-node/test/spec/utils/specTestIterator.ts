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
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.13/specs/phase0/fork-choice.md#filter_block_tree
// https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.13/specs/gloas/fork-choice.md#modified-get_node_children
const gloasComptestViableHeadLeaves = [
  "attester_slashing_test_0_229394564_1",
  "attester_slashing_test_2_199531672_1",
  "attester_slashing_test_2_199531672_2",
  "attester_slashing_test_2_999585566_1",
  "attester_slashing_test_2_999585566_2",
  "attester_slashing_test_2_999585566_3",
  "attester_slashing_test_3_148613234_3",
  "attester_slashing_test_3_925443969_3",
  "block_tree_test_0_584319467_1",
  "block_tree_test_0_830779549_1",
  "block_tree_test_108_89140732_1",
  "block_tree_test_10_103102469_0",
  "block_tree_test_10_103102469_1",
  "block_tree_test_10_547175397_0",
  "block_tree_test_10_547175397_1",
  "block_tree_test_114_572700892_1",
  "block_tree_test_114_751544032_1",
  "block_tree_test_115_758879335_1",
  "block_tree_test_11_122544814_1",
  "block_tree_test_12_15989172_0",
  "block_tree_test_12_15989172_1",
  "block_tree_test_12_39323199_0",
  "block_tree_test_12_39323199_1",
  "block_tree_test_13_136096093_0",
  "block_tree_test_13_136096093_1",
  "block_tree_test_13_352029666_0",
  "block_tree_test_14_423984223_1",
  "block_tree_test_14_486487734_1",
  "block_tree_test_15_187988843_0",
  "block_tree_test_15_187988843_1",
  "block_tree_test_15_397678783_0",
  "block_tree_test_15_397678783_1",
  "block_tree_test_16_192131493_1",
  "block_tree_test_16_767055976_0",
  "block_tree_test_16_767055976_1",
  "block_tree_test_17_522469337_1",
  "block_tree_test_18_157726799_1",
  "block_tree_test_18_336859186_1",
  "block_tree_test_19_202277391_1",
  "block_tree_test_19_424057724_0",
  "block_tree_test_19_424057724_1",
  "block_tree_test_1_188666282_0",
  "block_tree_test_1_188666282_1",
  "block_tree_test_1_982677656_1",
  "block_tree_test_20_685542367_1",
  "block_tree_test_21_113712082_0",
  "block_tree_test_21_113712082_1",
  "block_tree_test_21_901424465_1",
  "block_tree_test_22_281007766_0",
  "block_tree_test_22_281007766_1",
  "block_tree_test_22_629772785_1",
  "block_tree_test_23_127975443_1",
  "block_tree_test_23_173289686_1",
  "block_tree_test_25_162327899_1",
  "block_tree_test_26_302285898_1",
  "block_tree_test_26_367480762_1",
  "block_tree_test_27_797257085_1",
  "block_tree_test_27_990716031_0",
  "block_tree_test_27_990716031_1",
  "block_tree_test_28_2361900_0",
  "block_tree_test_28_2361900_1",
  "block_tree_test_28_88509995_0",
  "block_tree_test_28_88509995_1",
  "block_tree_test_29_525373279_1",
  "block_tree_test_29_753836374_1",
  "block_tree_test_2_10055342_0",
  "block_tree_test_2_10055342_1",
  "block_tree_test_30_640174143_0",
  "block_tree_test_30_640174143_1",
  "block_tree_test_30_981725213_0",
  "block_tree_test_30_981725213_1",
  "block_tree_test_31_151796844_1",
  "block_tree_test_31_833747005_1",
  "block_tree_test_3_371263898_1",
  "block_tree_test_3_543620434_0",
  "block_tree_test_3_543620434_1",
  "block_tree_test_4_252898721_0",
  "block_tree_test_4_252898721_1",
  "block_tree_test_4_784034875_1",
  "block_tree_test_59_226676322_1",
  "block_tree_test_5_820742541_0",
  "block_tree_test_5_820742541_1",
  "block_tree_test_5_968659210_0",
  "block_tree_test_5_968659210_1",
  "block_tree_test_64_40925638_1",
  "block_tree_test_69_919288537_1",
  "block_tree_test_6_334933186_0",
  "block_tree_test_6_334933186_1",
  "block_tree_test_6_793368438_0",
  "block_tree_test_6_793368438_1",
  "block_tree_test_75_133237592_1",
  "block_tree_test_75_610295373_1",
  "block_tree_test_7_118905275_1",
  "block_tree_test_87_211102291_1",
  "block_tree_test_8_205049417_0",
  "block_tree_test_8_205049417_1",
  "block_tree_test_8_393045125_1",
  "block_tree_test_99_135269128_1",
  "block_tree_test_99_13591888_1",
  "block_tree_test_9_128505862_1",
  "block_tree_test_9_874594591_1",
  "block_weight_test_0_132761755_1",
  "block_weight_test_0_322010656_1",
  "block_weight_test_1_233956560_1",
  "block_weight_test_1_375479616_1",
  "block_weight_test_2_119436539_1",
  "block_weight_test_2_363602106_1",
  "block_weight_test_2_488727854_1",
  "block_weight_test_2_490136092_1",
  "block_weight_test_2_491609511_1",
  "block_weight_test_2_553040868_1",
  "block_weight_test_2_565093600_1",
  "block_weight_test_2_668682363_1",
  "block_weight_test_2_830726258_1",
  "block_weight_test_2_902056632_1",
  "block_weight_test_2_924337272_1",
  "block_weight_test_3_180938266_1",
  "invalid_message_test_2_54153797_1",
  "shuffling_test_3_773362316_10",
  "shuffling_test_3_773362316_12",
  "shuffling_test_3_773362316_15",
  "shuffling_test_3_773362316_2",
  "shuffling_test_3_773362316_21",
  "shuffling_test_3_773362316_22",
  "shuffling_test_3_773362316_27",
  "shuffling_test_3_773362316_28",
  "shuffling_test_3_773362316_3",
  "shuffling_test_3_773362316_31",
];

// TODO-GLOAS: re-enable after https://github.com/ChainSafe/lodestar/issues/9694 is resolved.
// Proposer boost weight is quantized to EFFECTIVE_BALANCE_INCREMENT units twice, losing 0.4 ETH.
const gloasComptestProposerBoostWeight = [
  "block_cover_test_10_395149528_0",
  "block_cover_test_10_547208812_0",
  "block_cover_test_11_761180942_0",
  "block_cover_test_11_975049978_0",
  "block_cover_test_1_534680541_0",
  "block_cover_test_1_559550878_0",
  "block_cover_test_2_501232078_0",
  "block_cover_test_2_92546029_0",
  "block_cover_test_3_389327390_0",
  "block_cover_test_3_761896693_0",
  "block_cover_test_9_380835889_0",
  "block_cover_test_9_478088650_0",
  "block_tree_test_102_400635768_0",
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
    // Same issue (https://github.com/ChainSafe/lodestar/issues/9666), gloas copy: the block arrives
    // at an epoch-boundary slot start; the spec computes `head = get_head(store)` fresh inside
    // `on_block` after the tick's checkpoint updates, while Lodestar's dependent-root gate reads the
    // stale cached head, so `is_same_dependent_root` differs and the boost is wrongly denied.
    // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.13/specs/gloas/fork-choice.md#modified-update_proposer_boost_root
    gloasComptestCases(["block_tree_test_13_352029666_1"]),
    gloasComptestCases(gloasComptestViableHeadLeaves),
    gloasComptestCases(gloasComptestProposerBoostWeight),
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
