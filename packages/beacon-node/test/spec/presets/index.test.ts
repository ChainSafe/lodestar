import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {Type} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

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
const skipOpts: SkipOpts = {};

/* eslint-disable @typescript-eslint/naming-convention */

// TODO: capella
// Map all lightclient types to altair for addressing the specs
// which are are to be updated in separate PR
const overrideSSZTypes: Record<string, Record<string, Type<any>>> = {
  deneb: {
    LightClientHeader: ssz.altair.LightClientHeader,
    LightClientUpdate: ssz.altair.LightClientUpdate,
    LightClientOptimisticUpdate: ssz.altair.LightClientOptimisticUpdate,
    LightClientFinalityUpdate: ssz.altair.LightClientFinalityUpdate,
    LightClientBootstrap: ssz.altair.LightClientBootstrap,
  },
  capella: {
    LightClientHeader: ssz.altair.LightClientHeader,
    LightClientUpdate: ssz.altair.LightClientUpdate,
    LightClientOptimisticUpdate: ssz.altair.LightClientOptimisticUpdate,
    LightClientFinalityUpdate: ssz.altair.LightClientFinalityUpdate,
    LightClientBootstrap: ssz.altair.LightClientBootstrap,
  },
  bellatrix: {
    LightClientHeader: ssz.altair.LightClientHeader,
    LightClientUpdate: ssz.altair.LightClientUpdate,
    LightClientOptimisticUpdate: ssz.altair.LightClientOptimisticUpdate,
    LightClientFinalityUpdate: ssz.altair.LightClientFinalityUpdate,
    LightClientBootstrap: ssz.altair.LightClientBootstrap,
  },
};

specTestIterator(
  path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET),
  {
    epoch_processing: {
      type: RunnerType.default,
      fn: epochProcessing([
        // TODO: invalid_large_withdrawable_epoch asserts an overflow on a u64 for its exit epoch.
        // Currently unable to reproduce in Lodestar, skipping for now
        // https://github.com/ethereum/consensus-specs/blob/3212c419f6335e80ed825b4855a071f76bef70c3/tests/core/pyspec/eth2spec/test/phase0/epoch_processing/test_process_registry_updates.py#L349
        "invalid_large_withdrawable_epoch",
      ]),
    },
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
      fn: sszStatic(undefined, overrideSSZTypes),
    },
    sync: {type: RunnerType.default, fn: forkChoiceTest({onlyPredefinedResponses: true})},
    transition: {
      type: RunnerType.default,
      fn: transition(),
    },
  },
  skipOpts
);
