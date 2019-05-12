/**
 * @module chain/stateTransition/util
 */

import assert from "assert";

import {
  ACTIVATION_EXIT_DELAY,
  LATEST_ACTIVE_INDEX_ROOTS_LENGTH,
  LATEST_RANDAO_MIXES_LENGTH,
  MIN_SEED_LOOKAHEAD,
} from "../../../constants";

import {
  BeaconState,
  bytes32,
  Epoch,
} from "../../../types";


import {intToBytes} from "../../../util/bytes";
import {hash} from "../../../util/crypto";

import {getCurrentEpoch} from "./epoch";

/**
 * Return the randao mix at a recent epoch.
 */
export function getRandaoMix(state: BeaconState, epoch: Epoch): bytes32 {
  const currentEpoch = getCurrentEpoch(state);
  assert(
    (currentEpoch - LATEST_RANDAO_MIXES_LENGTH) < epoch &&
    epoch < currentEpoch
  );
  return state.latestRandaoMixes[epoch % LATEST_RANDAO_MIXES_LENGTH];
}

/**
 * Return the index root at a recent epoch.
 */
export function getActiveIndexRoot(state: BeaconState, epoch: Epoch): bytes32 {
  const currentEpoch = getCurrentEpoch(state);
  assert(
    currentEpoch - LATEST_ACTIVE_INDEX_ROOTS_LENGTH + ACTIVATION_EXIT_DELAY < epoch &&
    epoch <= currentEpoch + ACTIVATION_EXIT_DELAY
  );
  return state.latestActiveIndexRoots[epoch % LATEST_ACTIVE_INDEX_ROOTS_LENGTH];
}

/**
 * Generate a seed for the given epoch.
 */
export function generateSeed(state: BeaconState, epoch: Epoch): bytes32 {
  return hash(Buffer.concat([
    getRandaoMix(state, epoch - MIN_SEED_LOOKAHEAD),
    getActiveIndexRoot(state, epoch),
    intToBytes(epoch, 32),
  ]));
}
