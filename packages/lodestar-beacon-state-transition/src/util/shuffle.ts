/**
 * @module util/objects
 */
import {hash} from "@chainsafe/ssz";
import {
  ValidatorIndex,
  Bytes32,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {assert, bytesToBigInt} from "@chainsafe/lodestar-utils";


// ShuffleList shuffles a list, using the given seed for randomness. Mutates the input list.
export function shuffleList(config: IBeaconConfig, input: ValidatorIndex[], seed: Bytes32): void {
  innerShuffleList(config, input, seed, true);
}


// UnshuffleList undoes a list shuffling using the seed of the shuffling. Mutates the input list.
export function unshuffleList(config: IBeaconConfig, input: ValidatorIndex[], seed: Bytes32): void {
  innerShuffleList(config, input, seed, false);
}

const _SHUFFLE_H_SEED_SIZE = 32;
const _SHUFFLE_H_ROUND_SIZE = 1;
const _SHUFFLE_H_POSITION_WINDOW_SIZE = 4;
const _SHUFFLE_H_PIVOT_VIEW_SIZE = _SHUFFLE_H_SEED_SIZE + _SHUFFLE_H_ROUND_SIZE;
const _SHUFFLE_H_TOTAL_SIZE = _SHUFFLE_H_SEED_SIZE + _SHUFFLE_H_ROUND_SIZE + _SHUFFLE_H_POSITION_WINDOW_SIZE;


/*

def shuffle(list_size, seed):
    indices = list(range(list_size))
    for round in range(90):
        hash_bytes = b''.join([
            hash(seed + round.to_bytes(1, 'little') + (i).to_bytes(4, 'little'))
            for i in range((list_size + 255) // 256)
        ])
        pivot = int.from_bytes(hash(seed + round.to_bytes(1, 'little')), 'little') % list_size

        powers_of_two = [1, 2, 4, 8, 16, 32, 64, 128]

        for i, index in enumerate(indices):
            flip = (pivot - index) % list_size
            hash_pos = index if index > flip else flip
            byte = hash_bytes[hash_pos // 8]
            if byte & powers_of_two[hash_pos % 8]:
                indices[i] = flip
    return indices

Heavily-optimized version of the set-shuffling algorithm proposed by Vitalik to shuffle all items in a list together.

Original here:
	https://github.com/ethereum/eth2.0-specs/pull/576#issue-250741806

Main differences, implemented by @protolambda:
    - User can supply input slice to shuffle, simple provide [0,1,2,3,4, ...] to get a list of cleanly shuffled indices.
    - Input slice is shuffled (hence no return value), no new array is allocated
    - Allocations as minimal as possible: only a very minimal buffer for hashing
	  (this should be allocated on the stack, compiler will find it with escape analysis).
		This is not bigger than what's used for shuffling a single index!
		As opposed to larger allocations (size O(n) instead of O(1)) made in the original.
    - Replaced pseudocode/python workarounds with bit-logic.
    - User can provide their own hash-function (as long as it outputs a 32 len byte slice)

This Typescript version is an adaption of the Python version, in turn an adaption of the original Go version.
Python: https://github.com/protolambda/eth2fastspec/blob/14e04e9db77ef7c8b7788ffdaa7e142d7318dd7e/eth2fastspec.py#L63
Go: https://github.com/protolambda/eth2-shuffle
All three implemented by @protolambda, but meant for public use, like the original spec version.
*/

// Shuffles or unshuffles, depending on the `dir` (true for shuffling, false for unshuffling
function innerShuffleList(config: IBeaconConfig, input: ValidatorIndex[], seed: Bytes32, dir: boolean): void {
  if (input.length <= 1) {
    // nothing to (un)shuffle
    return;
  }
  if (config.params.SHUFFLE_ROUND_COUNT == 0) {
    // no shuffling
    return;
  }
  // uint32 is sufficient, and necessary in JS,
  // as we do a lot of bit math on it, which cannot be done as fast on more bits.
  const listSize = input.length >>> 0;
  // check if list size fits in uint32
  assert(listSize == input.length);

  const buf = Buffer.alloc(_SHUFFLE_H_TOTAL_SIZE);
  let r = 0;
  if (!dir) {
    // Start at last round.
    // Iterating through the rounds in reverse, un-swaps everything, effectively un-shuffling the list.
    r = config.params.SHUFFLE_ROUND_COUNT - 1;
  }

  // Seed is always the first 32 bytes of the hash input, we never have to change this part of the buffer.
  const _seed = seed.valueOf() as Uint8Array;
  new Buffer(_seed).copy(buf, 0, 0, _SHUFFLE_H_SEED_SIZE);

  function setPositionUint32(value: number): void {
    // Little endian, optimized version
    buf[_SHUFFLE_H_PIVOT_VIEW_SIZE] = (value >> 0) & 0xff;
    buf[_SHUFFLE_H_PIVOT_VIEW_SIZE + 1] = (value >> 8) & 0xff;
    buf[_SHUFFLE_H_PIVOT_VIEW_SIZE + 2] = (value >> 16) & 0xff;
    buf[_SHUFFLE_H_PIVOT_VIEW_SIZE + 3] = (value >> 24) & 0xff;
  }

  // initial values here are not used: overwritten first within the inner for loop.
  let source = seed; // just setting it to a Bytes32
  let i = 0;
  let j = 0;
  let byteV = 0;

  function step(): void {
    // The pair is i,j. With j being the bigger of the two, hence the "position" identifier of the pair.
    // Every 256th bit (aligned to j).
    if ((j & 0xff) == 0xff) {
      // just overwrite the last part of the buffer, reuse the start (seed, round)
      setPositionUint32(j >> 8);
      source = hash(buf);
    }

    // Same trick with byte retrieval. Only every 8th.
    if ((j & 0x7) == 0x7) {
      byteV = source[(j & 0xff) >> 3];
    }

    const bitV = (byteV >> (j & 0x7)) & 0x1;

    if (bitV == 1) {
      // swap the pair items
      const tmp = input[j];
      input[j] = input[i];
      input[i] = tmp;
    }

    i = i + 1;
    j = j - 1;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // spec: pivot = bytes_to_int(hash(seed + int_to_bytes1(round))[0:8]) % list_size
    // This is the "int_to_bytes1(round)", appended to the seed.
    buf[_SHUFFLE_H_SEED_SIZE] = r;
    // Seed is already in place, now just hash the correct part of the buffer, and take a uint64 from it,
    //  and modulo it to get a pivot within range.
    const h = hash(buf.slice(0, _SHUFFLE_H_PIVOT_VIEW_SIZE));
    const pivot = Number(bytesToBigInt(h.slice(0, 8)) % BigInt(listSize)) >>> 0;

    // Split up the for-loop in two:
    //  1. Handle the part from 0 (incl) to pivot (incl). This is mirrored around (pivot / 2)
    //  2. Handle the part from pivot (excl) to N (excl). This is mirrored around ((pivot / 2) + (size/2))
    // The pivot defines a split in the array, with each of the splits mirroring their data within the split.
    // Print out some example even/odd sized index lists, with some even/odd pivots,
    //  and you can deduce how the mirroring works exactly.
    // Note that the mirror is strict enough to not consider swapping the index @mirror with itself.
    let mirror = (pivot + 1) >> 1;
    // Since we are iterating through the "positions" in order, we can just repeat the hash every 256th position.
    // No need to pre-compute every possible hash for efficiency like in the example code.
    // We only need it consecutively (we are going through each in reverse order however, but same thing)
    //
    // spec: source = hash(seed + int_to_bytes1(round) + int_to_bytes4(position // 256))
    // - seed is still in 0:32 (excl., 32 bytes)
    // - round number is still in 32
    // - mix in the position for randomness, except the last byte of it,
    //   which will be used later to select a bit from the resulting hash.
    // We start from the pivot position, and work back to the mirror position (of the part left to the pivot).
    // This makes us process each pear exactly once (instead of unnecessarily twice, like in the spec)
    setPositionUint32(pivot >> 8); // already using first pivot byte below.
    source = hash(buf);
    byteV = source[(pivot & 0xff) >> 3];
    i = 0;
    j = pivot;

    while (i < mirror) {
      step();
    }

    // Now repeat, but for the part after the pivot.
    mirror = (pivot + listSize + 1) >> 1;
    const end = listSize - 1;
    // Again, seed and round input is in place, just update the position.
    // We start at the end, and work back to the mirror point.
    // This makes us process each pear exactly once (instead of unnecessarily twice, like in the spec)
    setPositionUint32(end >> 8);
    source = hash(buf);
    byteV = source[(end & 0xff) >> 3];
    i = pivot + 1;
    j = end;
    while (i < mirror) {
      step();
    }

    // go forwards?
    if (dir) {
      // -> shuffle
      r += 1;
      if (r == config.params.SHUFFLE_ROUND_COUNT) {
        break;
      }
    } else {
      if (r == 0) {
        break;
      }
      // -> un-shuffle
      r -= 1;
    }
  }
}
