import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {RunnerType} from "../utils/types.js";
import {epochProcessing} from "./epoch_processing.js";
import {finality} from "./finality.js";
import {fork} from "./fork.js";
import {forkChoiceTest} from "./fork_choice.js";
import {genesis} from "./genesis.js";
import {merkle} from "./merkle.js";
import {operations} from "./operations.js";
import {rewards} from "./rewards.js";
import {sanity, sanityBlocks} from "./sanity.js";
import {shuffling} from "./shuffling.js";
import {sszStatic} from "./ssz_static.js";
import {transition} from "./transition.js";
import {specTestIterator} from "../utils/specTestIterator.js";

/* eslint-disable @typescript-eslint/naming-convention */

specTestIterator(ACTIVE_PRESET, {
  epoch_processing: {type: RunnerType.default, fn: epochProcessing},
  finality: {type: RunnerType.default, fn: finality},
  fork: {type: RunnerType.default, fn: fork},
  fork_choice: {type: RunnerType.default, fn: forkChoiceTest},
  genesis: {type: RunnerType.default, fn: genesis},
  merkle: {type: RunnerType.default, fn: merkle},
  operations: {type: RunnerType.default, fn: operations},
  random: {type: RunnerType.default, fn: sanityBlocks},
  rewards: {type: RunnerType.default, fn: rewards},
  sanity: {type: RunnerType.default, fn: sanity},
  shuffling: {type: RunnerType.default, fn: shuffling},
  ssz_static: {type: RunnerType.custom, fn: sszStatic},
  transition: {type: RunnerType.default, fn: transition},
});
