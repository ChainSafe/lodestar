import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {RunnerType} from "../utils/types";
import {epochProcessing} from "./epoch_processing";
import {finality} from "./finality";
import {fork} from "./fork";
import {forkChoiceTest} from "./fork_choice";
import {genesis} from "./genesis";
import {merkle} from "./merkle";
import {operations} from "./operations";
import {rewards} from "./rewards";
import {sanity, sanityBlocks} from "./sanity";
import {shuffling} from "./shuffling";
import {sszStatic} from "./ssz_static";
import {transition} from "./transition";
import {specTestIterator} from "../utils/specTestIterator";

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
