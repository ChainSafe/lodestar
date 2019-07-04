/**
 * @module chain/stateTransition/util
 */

import {
  BeaconState,
  bytes32,
  Epoch,
} from "../../../types";
import {BeaconConfig} from "../../../config";


import {intToBytes} from "../../../util/bytes";
import {hash} from "../../../util/crypto";


/**
 * Return the randao mix at a recent epoch.
 *
 * ``epoch`` expected to be between
 * (current_epoch - LATEST_ACTIVE_INDEX_ROOTS_LENGTH + ACTIVATION_EXIT_DELAY
 * , current_epoch + ACTIVATION_EXIT_DELAY].
 */
export function getRandaoMix(config: BeaconConfig, state: BeaconState, epoch: Epoch): bytes32 {
  return state.latestRandaoMixes[epoch % config.params.LATEST_RANDAO_MIXES_LENGTH];
}

/**
 * Return the index root at a recent epoch.
 *
 * ``epoch`` expected to be between
 * (current_epoch - LATEST_ACTIVE_INDEX_ROOTS_LENGTH + ACTIVATION_EXIT_DELAY
 * , current_epoch + ACTIVATION_EXIT_DELAY].
 */
export function getActiveIndexRoot(config: BeaconConfig, state: BeaconState, epoch: Epoch): bytes32 {
  return state.latestActiveIndexRoots[epoch % config.params.LATEST_ACTIVE_INDEX_ROOTS_LENGTH];
}

/**
 * Generate a seed for the given epoch.
 */
export function generateSeed(config: BeaconConfig, state: BeaconState, epoch: Epoch): bytes32 {
  return hash(Buffer.concat([
    getRandaoMix(config, state, epoch + config.params.LATEST_RANDAO_MIXES_LENGTH - config.params.MIN_SEED_LOOKAHEAD),
    getActiveIndexRoot(config, state, epoch),
    intToBytes(epoch, 32),
  ]));
}
