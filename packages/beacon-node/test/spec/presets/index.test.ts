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

// Just disable all capella tests as well and renable when new vectors are released
// because the latest withdrawals we implemented are a breaking change
const skipOpts: SkipOpts = {
  skippedForks: [],
  skippedRunners: [],
  skippedHandlers: ["full_withdrawals", "partial_withdrawals", "bls_to_execution_change", "withdrawals"],
};

/* eslint-disable @typescript-eslint/naming-convention */

specTestIterator(
  path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET),
  {
    epoch_processing: {type: RunnerType.default, fn: epochProcessing(["invalid_large_withdrawable_epoch"])},
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
    ssz_static: {
      type: RunnerType.custom,
      fn: sszStatic([
        "LightClientUpdate",
        "LightClientBootstrap",
        "LightClientFinalityUpdate",
        "LightClientOptimisticUpdate",
      ]),
    },
    sync: {type: RunnerType.default, fn: forkChoiceTest({onlyPredefinedResponses: true})},
    transition: {type: RunnerType.default, fn: transition},
  },
  skipOpts
);
