import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {RunnerType} from "../utils/types.js";
import {SkipOpts, specTestIterator} from "../utils/specTestIterator.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {epochProcessing} from "./epoch_processing.js";
import {finality} from "./finality.js";
import {fork} from "./fork.js";
import {forkChoiceTest} from "./fork_choice.js";
import {genesis} from "./genesis.js";
import {lightClient} from "./light_client/index.js";
import {merkle} from "./merkle.js";
import {operations} from "./operations.js";
import {rewards} from "./rewards.js";
import {sanity, sanityBlocks} from "./sanity.js";
import {shuffling} from "./shuffling.js";
import {sszStatic} from "./ssz_static.js";
import {transition} from "./transition.js";

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
const skipOpts: SkipOpts = {
  skippedPrefixes: [
    // Skipped since this only test that withdrawals are de-activated.
    // Enable once spec test v1.3.0 are released and withdrawals are active on eip4844
    "eip4844/operations/bls_to_execution_change",
    "eip4844/operations/withdrawals",

    // TODO: Investivate why these tests fail, they error with
    // TypeError: Cannot read properties of undefined (reading 'toValue')
    //   at expectEqualBeaconState (file:///home/lion/Code/eth2.0/lodestar/packages/beacon-node/test/spec/utils/expectEqualBeaconState.ts:14:33)
    //   at Object.expectFunc (file:///home/lion/Code/eth2.0/lodestar/packages/beacon-node/test/spec/presets/epoch_processing.ts:77:9)
    //   at Context.<anonymous> (file:///home/lion/Code/eth2.0/lodestar/packages/spec-test-util/src/single.ts:142:19)
    "phase0/epoch_processing/registry_updates",
    "altair/epoch_processing/registry_updates",
    "bellatrix/epoch_processing/registry_updates",
    "capella/epoch_processing/registry_updates",
    "eip4844/epoch_processing/registry_updates",
  ],
};

/* eslint-disable @typescript-eslint/naming-convention */

specTestIterator(
  path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET),
  {
    epoch_processing: {type: RunnerType.default, fn: epochProcessing()},
    finality: {type: RunnerType.default, fn: finality},
    fork: {type: RunnerType.default, fn: fork},
    fork_choice: {type: RunnerType.default, fn: forkChoiceTest({onlyPredefinedResponses: false})},
    genesis: {type: RunnerType.default, fn: genesis},
    light_client: {type: RunnerType.default, fn: lightClient},
    merkle: {type: RunnerType.default, fn: merkle},
    operations: {type: RunnerType.default, fn: operations},
    random: {type: RunnerType.default, fn: sanityBlocks},
    rewards: {type: RunnerType.default, fn: rewards},
    sanity: {type: RunnerType.default, fn: sanity},
    shuffling: {type: RunnerType.default, fn: shuffling},
    ssz_static: {type: RunnerType.custom, fn: sszStatic()},
    sync: {type: RunnerType.default, fn: forkChoiceTest({onlyPredefinedResponses: true})},
    transition: {type: RunnerType.default, fn: transition},
  },
  skipOpts
);
