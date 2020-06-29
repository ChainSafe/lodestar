/**
 * @module chain/stateTransition/util
 */

import {hash} from "@chainsafe/ssz";
import {
  Epoch,
  BeaconState,
  Bytes32,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert, bytesToBigInt, intToBytes,intDiv} from "@chainsafe/lodestar-utils";
import {DomainType} from "../constants";



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
  index: number,
  indexCount: number,
  seed: Bytes32
): number {
  let permuted = index;
  assert(index < indexCount);
  assert(indexCount <= 2 ** 40);
  const _seed = seed.valueOf() as Uint8Array;
  for (let i = 0; i < config.params.SHUFFLE_ROUND_COUNT; i++) {
    const pivot = Number(bytesToBigInt(
      hash(Buffer.concat([_seed, intToBytes(i, 1)]))
        .slice(0, 8)
    ) % BigInt(indexCount));
    const flip = (pivot + indexCount - permuted) % indexCount;
    const position = Math.max(permuted, flip);
    const source = hash(Buffer.concat([
      _seed,
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
export function getRandaoMix(config: IBeaconConfig, state: BeaconState, epoch: Epoch): Bytes32 {
  return state.randaoMixes[epoch % config.params.EPOCHS_PER_HISTORICAL_VECTOR];
}

/**
 * Return the seed at [[epoch]].
 */
export function getSeed(config: IBeaconConfig, state: BeaconState, epoch: Epoch, domainType: DomainType): Uint8Array {
  const mix = getRandaoMix(
    config,
    state,
    epoch + config.params.EPOCHS_PER_HISTORICAL_VECTOR - config.params.MIN_SEED_LOOKAHEAD - 1
  );

  return hash(Buffer.concat([
    intToBytes(domainType, 4),
    intToBytes(epoch, 8),
    mix.valueOf() as Uint8Array,
  ]));
}
