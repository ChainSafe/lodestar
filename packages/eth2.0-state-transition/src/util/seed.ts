/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {
  Epoch,
  ValidatorIndex,
  BeaconState,
  Hash,
} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {bytesToBN, intToBytes} from "@chainsafe/eth2.0-utils";
import {intDiv, hash} from "@chainsafe/eth2.0-utils";


/**
 * Return the shuffled validator index corresponding to ``seed`` (and ``index_count``).
 *
 * Swap or not
 * https://link.springer.com/content/pdf/10.1007%2F978-3-642-32009-5_1.pdf
 *
 * See the 'generalized domain' algorithm on page 3.
 */
export function computeShuffledIndex(
  config: IBeaconConfig,
  index: ValidatorIndex,
  indexCount: number,
  seed: Hash
): number {
  let permuted = index;
  assert(index < indexCount);
  assert(indexCount <= 2 ** 40);
  for (let i = 0; i < config.params.SHUFFLE_ROUND_COUNT; i++) {
    const pivot = bytesToBN(
      hash(Buffer.concat([seed, intToBytes(i, 1)]))
        .slice(0, 8)
    ).modn(indexCount);
    const flip = (pivot + indexCount - permuted) % indexCount;
    const position = Math.max(permuted, flip);
    const source = hash(Buffer.concat([
      seed,
      intToBytes(i, 1),
      intToBytes(intDiv(position, 256), 4),
    ]));
    const byte = source[intDiv(position % 256, 8)];
    const bit = (byte >> (position % 8)) % 2;
    permuted = bit ? flip : permuted;
  }
  return permuted;
}

/**
 * Return the randao mix at a recent [[epoch]].
 */
export function getRandaoMix(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Hash {
  return state.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR];
}

/**
 * Return the seed at [[epoch]].
 */
export function getSeed(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Hash {
  return hash(Buffer.concat([
    getRandaoMix(
      config,
      state,
      epoch + config.params.EPOCHS_PER_HISTORICAL_VECTOR - config.params.MIN_SEED_LOOKAHEAD - 1
    ),
    state.activeIndexRoots[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR],
    intToBytes(epoch, 32),
  ]));
}
