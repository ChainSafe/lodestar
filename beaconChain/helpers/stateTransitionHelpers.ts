import { keccakAsU8a } from "@polkadot/util-crypto";
import {
  ENTRY_EXIT_DELAY,
  EPOCH_LENGTH, GENESIS_EPOCH, LATEST_BLOCK_ROOTS_LENGTH, LATEST_INDEX_ROOTS_LENGTH,
  LATEST_RANDAO_MIXES_LENGTH,
  MAX_DEPOSIT_AMOUNT,
  SHARD_COUNT,
  TARGET_COMMITTEE_SIZE,
} from "../constants/constants";
import {
  AttestationData,
  BeaconState, Bytes32,
  Fork,
  EpochNumber,
  Validator, ValidatorIndex, SlotNumber,
} from "../types";

type int = number;
type hash32 = Uint8Array;

/**
 * Return the epoch number of the given slot.
 * @param {SlotNumber} slot
 * @returns {EpochNumber}
 */
export function slotToEpoch(slot: SlotNumber): EpochNumber {
  return Math.floor(slot / EPOCH_LENGTH);
}

/**
 * Return the current epoch of the given state.
 * @param {BeaconState} state
 * @returns {EpochNumber}
 */
export function getCurrentEpoch(state: BeaconState): EpochNumber {
  return slotToEpoch(state.slot);
}

/**
 * Return the starting slot of the given epoch.
 * @param {EpochNumber} epoch
 * @returns {SlotNumber}
 */
export function getEpochStartSlot(epoch: EpochNumber): SlotNumber {
  return epoch * EPOCH_LENGTH;
}

/**
 * Checks to see if a validator is active.
 * @param {Validator} validator
 * @param {EpochNumber} epoch
 * @returns {boolean}
 */
export function isActiveValidator(validator: Validator, epoch: EpochNumber): boolean {
  return validator.activationEpoch <= epoch && epoch < validator.exitEpoch;
}

/**
 * Get indices of active validators from validators.
 * @param {Validator[]} validators
 * @param {EpochNumber} epoch
 * @returns {ValidatorIndex[]}
 */
export function getActiveValidatorIndices(validators: Validator[], epoch: EpochNumber): ValidatorIndex[] {
  return validators.reduce((accumulator: int[], validator: Validator, index: int) => {
    return isActiveValidator(validator, epoch)
    ? [...accumulator, index]
    : accumulator;
  }, []);
}

// Modified from: https://github.com/feross/buffer/blob/master/index.js#L1125
export function readUIntBE(array: Uint8Array, offset: number, byteLength: number): number {
    let val: number = array[offset + --byteLength];
    let mul: number = 1;
    while (byteLength > 0) {
        mul *= 0x100;
        val += array[offset + --byteLength] * mul;
    }
    return val;
}

/**
 * The following is a function that shuffles any list; we primarily use it for the validator list.
 * @param {T[]} values
 * @param {hash32} seed
 * @returns {T[]} Returns the shuffled values with seed as entropy.
 */
function shuffle<T>(values: T[], seed: Bytes32): T[] {
  const valuesCount: int = values.length;
  // Entropy is consumed from the seed in 3-byte (24 bit) chunks.
  const randBytes: number = 3;
  // Highest possible result of the RNG
  const randMax: number = 2 ** (randBytes * 8) - 1;

  // The range of the RNG places an upper-bound on the size of the list that may be shuffled.
  // It is a logic error to supply an oversized list.
  if (!(valuesCount < randMax)) { throw new Error("Oversized list supplied to shuffle!"); }

  // Make a copy of the values
  const output: T[] = values.slice();
  let source: Uint8Array = seed;
  let index: number = 0;
  while (index < valuesCount - 1) {
    // Re-hash the `source` to obtain a new pattern of bytes.
    source = keccakAsU8a(source); // 32 bytes long

    // Iterate through the `source` bytes in 3-byte chunks.
    for (let position = 0; position < 32 - (32 % randBytes); position += randBytes) {
      // Determine the number of indices remaining in `values` and exit
      // once the last index is reached.
      const remaining: number = valuesCount - index;
      if (remaining === 1) {
        break;
      }
      // Read 3-bytes of `source` as a 24-bit big-endian integer.
      const sampleFromSource: number = readUIntBE(source.slice(position, position + randBytes), 0, randBytes);

      // Sample values greater than or equal to `sample_max` will cause
      // modulo bias when mapped into the `remaining` range.
      const sampleMax: number = randMax - randMax % remaining;

      // Perform a swap if the consumed entropy will not cause modulo bias.
      if (sampleFromSource < sampleMax) {
        // Select a replacement index for the current index.
        const replacementPosition: number = (sampleFromSource % remaining) + index;
        // Swap the current index with the replacement index.
        // tslint:disable-next-line no-unused-expression
        output[index], output[replacementPosition] = output[replacementPosition], output[index];
        index += 1;
      }
      // The sample causes modulo bias. A new sample should be read.
      // index = index
    }
  }
  return output;
}

/**
 * Splits a list into split_count pieces.
 * @param {T[]} values
 * @param {int} splitCount
 * @returns {T[]}
 */
export function split<T>(values: T[], splitCount: int): T[][] {
  const listLength: int = values.length;
  const array: T[][] = [];
  for (let i: int = 0; i < splitCount; i++) {
    array.push(values.slice(
      Math.floor((listLength * i) / splitCount), Math.floor((listLength * (i + 1)) / splitCount),
    ));
  }
  return array;
}

/**
 * Helper function for readability.
 * @param {int} minval
 * @param {int} maxval
 * @param {int} x
 * @returns {int}
 */
export function clamp(minval: int, maxval: int, x: int): int {
  if (x <= minval) {
    return minval;
  } else if (x >= maxval) {
    return maxval;
  }
  return x;
}

/**
 * Return the number of committees in one epoch.
 * @param {int} activeValidatorCount
 * @returns {Number}
 */
export function getEpochCommitteeCount(activeValidatorCount: int): int {
  return Math.max(
    1,
    Math.min(
      Math.floor(SHARD_COUNT / EPOCH_LENGTH),
      Math.floor(Math.floor(activeValidatorCount / EPOCH_LENGTH) / TARGET_COMMITTEE_SIZE),
    ),
  );
}

/**
 * Shuffles validators into shard committees seeded by seed and slot.
 * @param {hash32} seed
 * @param {Validator[]} validators
 * @param {int} slot
 * @returns {int[][]}
 */
export function getShuffling(seed: hash32, validators: Validator[], slot: int): int[][] {
  // Normalizes slot to start of epoch boundary
  slot -= slot % EPOCH_LENGTH;

  const activeValidatorIndices = getActiveValidatorIndices(validators, slot);

  const committeesPerSlot = getEpochCommitteeCount(activeValidatorIndices.length);

  // TODO fix below
  // Shuffle
  // const proposedSeed = new Uint8Array(slot);
  // const newSeed = seed ^ seedY;
  // const shuffledActiveValidatorIndices = shuffle(activeValidatorIndices, newSeed);
  const shuffledActiveValidatorIndices = shuffle(activeValidatorIndices, seed);

  // Split the shuffle list into EPOCH_LENGTH * committeesPerSlot pieces
  return split(shuffledActiveValidatorIndices, committeesPerSlot * EPOCH_LENGTH);
}

/**
 * Return the number of committees in the previous epoch of the given state.
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getPreviousEpochCommitteeCount(state: BeaconState): int {
  const previousActiveValidators = getActiveValidatorIndices(state.validatorRegistry, state.previousCalculationEpoch);
  return getEpochCommitteeCount(previousActiveValidators.length);
}

/**
 * Gets the current committee count per slot
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getCurrentEpochCommitteeCount(state: BeaconState): int {
  const currentActiveValidators = getActiveValidatorIndices(state.validatorRegistry, state.currentCalculationEpoch);
  return getEpochCommitteeCount(currentActiveValidators.length);
}

/**
 * Get's the next epoch committee count
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getNextEpochCommitteeCount(state: BeaconState): int {
  const nextActiveValidators = getActiveValidatorIndices(state.validatorRegistry, getCurrentEpoch(state) + 1);
  return getEpochCommitteeCount(nextActiveValidators.length);
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 * @param {BeaconState} state
 * @param {SlotNumber} slot
 * @param {boolean} registryChange
 * @returns {[]}
 */
function getCrosslinkCommitteesAtSlot(state: BeaconState, slot: SlotNumber, registryChange: boolean = false): {ShardNumber, ValidatorIndex}[] {
  const epoch = slotToEpoch(slot);
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : currentEpoch;
  const nextEpoch = currentEpoch + 1;

  if (previousEpoch <= epoch && epoch <= nextEpoch) { throw new Error("Slot is too early!"); }

  // variables
  let committeesPerEpoch;
  let seed;
  let shufflingEpoch;
  let shufflingStartShard;
  let currentCommitteesPerEpoch;

  if (epoch === previousEpoch) {
    committeesPerEpoch = getPreviousEpochCommitteeCount(state);
    seed = state.previousEpochSeed;
    shufflingEpoch = state.previousCalculationEpoch;
    shufflingStartShard = state.previousEpochStartShard;
  } else if (epoch === currentEpoch) {
    committeesPerEpoch = getCurrentEpochCommitteeCount(state);
    seed = state.currentEpochSeed;
    shufflingEpoch = state.currentCalculationEpoch;
    shufflingStartShard = state.currentEpochStartShard;
  } else if (epoch === nextEpoch) {
    currentCommitteesPerEpoch = getCurrentEpochCommitteeCount(state);
    committeesPerEpoch = getNextEpochCommitteeCount(state)
    shufflingEpoch = nextEpoch;

    const epochsSinceLastRegistryUpdate = currentEpoch - state.validatorRegistryUpdateEpoch;
    if (registryChange) {
      seed = generateSeed(state, nextEpoch);
      shufflingStartShard = (state.currentEpochStartShard + currentCommitteesPerEpoch) % SHARD_COUNT;
    } else if (epochsSinceLastRegistryUpdate > 1 && isPowerOfTwo(epochsSinceLastRegistryUpdate)) {
      seed = generateSeed(state, nextEpoch);
      shufflingStartShard = state.currentEpochStartShard;
    } else {
      seed = state.currentEpochSeed;
      shufflingStartShard = state.currentEpochStartShard;
    }
  }

  const shuffling = getShuffling(seed, state.validatorRegistry, shufflingEpoch);
  const offset = slot % EPOCH_LENGTH;
  const committeesPerSlot = Math.floor(committeesPerEpoch / EPOCH_LENGTH);
  const slotStartShard = (shufflingStartShard + committeesPerSlot * offset) % SHARD_COUNT;

  return Array.apply(null, Array(committeesPerSlot)).map((x, i) => {
    return {
      committee: shuffling[committeesPerSlot * offset + i],
      shard: (slotStartShard + i) % SHARD_COUNT
    }
  });
}

/**
 * Retrieves hash for a given beacon block.
 * It should always return the block hash in the beacon chain slot for `slot`.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {hash32}
 */
export function getBlockRoot(state: BeaconState, slot: int): Bytes32 {
  // Returns the block root at a recent ``slot``.
  if (state.slot <= slot + LATEST_BLOCK_ROOTS_LENGTH) { throw new Error(); }
  if (slot < state.slot) { throw new Error(); }
  return state.latestBlockRoots[slot % LATEST_BLOCK_ROOTS_LENGTH];
}

/**
 * Return the randao mix at a recent epoch.
 * @param {BeaconState} state
 * @param {EpochNumber} epoch
 * @returns {Bytes32}
 */
export function getRandaoMix(state: BeaconState, epoch: EpochNumber): Bytes32 {
  if (getCurrentEpoch(state) - LATEST_RANDAO_MIXES_LENGTH < epoch && epoch < getCurrentEpoch(state)) { throw new Error("")}
  return state.latestRandaoMixes[epoch % LATEST_RANDAO_MIXES_LENGTH];
}

/**
 * Return the index root at a recent epoch.
 * @param {BeaconState} state
 * @param {EpochNumber} epoch
 * @returns {Bytes32}
 */
export function getActiveIndexRoot(state: BeaconState, epoch: EpochNumber): Bytes32 {
  if (getCurrentEpoch(state) - LATEST_INDEX_ROOTS_LENGTH + ENTRY_EXIT_DELAY < epoch && epoch < getCurrentEpoch(state) + ENTRY_EXIT_DELAY) { throw new Error("")}
  return state.latestIndexRoots[epoch % LATEST_INDEX_ROOTS_LENGTH];
}

/**
 * Generate a seed for the given epoch.
 * @param {BeaconState} state
 * @param {EpochNumber} epoch
 * @returns {Bytes32}
 */
// TODO FINSIH
export function generateSeed(state: BeaconState, epoch: EpochNumber): Bytes32 {
  // return hash(
  //   getRandaoMix(state, epoch - SEED_LOOKAHEAD) + getActiveIndexRoot(state, epoch))
  // )
  return new Uint8Array(1);
}

/**
 * Return the beacon proposer index for the slot.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {int}
 */
export function getBeaconProposerIndex(state: BeaconState, slot: int): int {
  const firstCommittee = getCrosslinkCommitteesAtSlot(state, slot)[0].ValidatorIndex;
  return firstCommittee[slot % firstCommittee.length];
}

/**
 * Merkleize values where the length of values is a power of two and return the Merkle root.
 * @param {Bytes32[]} values
 * @returns {Bytes32}
 */
// TODO finish
// export function merkleRoot(values: Bytes32[]): Bytes32 {
//   let o: Uint8Array = new Uint8Array(values.length + 1);
//   o.set(values, o.length - 1);
// }

// // TODO finish
// function getAttestationParticipants(state: BeaconState, attestationData: AttestationData, participationBitfield: bytes): int[] {
//   const crosslinkCommittee: CommitteeShard[] = getCrosslinkCommitteesAtSlot(state, attestationData.slot);
//
//   // assert attestation.shard in [shard for _, shard in crosslink_committees]
//   // crosslink_committee = [committee for committee, shard in crosslink_committees if shard == attestation_data.shard][0]
//   // assert len(participation_bitfield) == (len(committee) + 7) // 8
//
//   const shardCommittee: ShardCommittee = shardCommittees.filter((x: ShardCommittee) => {
//     return x.shard === attestationData.shard;
//   })[0];
//
//   // assert len(participation_bitfield) == ceil_div8(len(snc.committee))
//
//   const participants: int[] = shardCommittee.committee.filter((validator: uint24, index: int) => {
//     const bit: int = (participationBitfield[Math.floor(index / 8)] >> (7 - (index % 8))) % 2;
//     return bit === 1;
//   });
//   return participants;
// }

/**
 * Check if value is a power of two integer.
 * @param {int} value
 * @returns {boolean}
 */
export function isPowerOfTwo(value: int): boolean {
  return value === 0 ? false : 2 ** (Math.log2(value)) === value;
}

/**
 * Determine the balance of a validator.
 * @param {BeaconState} state
 * @param {int} index
 * @returns {Number}
 */
export function getEffectiveBalance(state: BeaconState, index: int): int {
  // Returns the effective balance (also known as "balance at stake") for a ``validator`` with the given ``index``.
  return Math.min(state.validatorBalances[index], MAX_DEPOSIT_AMOUNT);
}

/**
 * Return the fork version of the given epoch.
 * @param {Fork} fork
 * @param {EpochNumber} epoch
 * @returns {Number}
 */
export function getForkVersion(fork: Fork, epoch: EpochNumber): int {
  return epoch < fork.epoch ? fork.previousVersion : fork.currentVersion;
}

/**
 * Get the domain number that represents the fork meta and signature domain.
 * @param {Fork} fork
 * @param {EpochNumber} epoch
 * @param {int} domainType
 * @returns {Number}
 */
export function getDomain(fork: Fork, epoch: EpochNumber, domainType: int): int {
  return (getForkVersion(fork, epoch) * 2 ** 32) + domainType;
}

// TODO finish
// export function getBitfieldBit(bitfied: bytes, i: int): int {
//
// }

// TODO finish
// export function verifyBitfield(bitfield: bytes, committeeSize: int): boolean {
//
// }

// TODO finish
// export function verifySlashableVoteData(state: BeaconState, slashableAttestation: SlashableAttestation): boolean {
// }

/**
 * Check if attestationData1 and attestationData2 have the same target.
 * @param {AttestationData} attestationData1
 * @param {AttestationData} attestationData2
 * @returns {boolean}
 */
export function isDoubleVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const targetEpoch1: int = slotToEpoch(attestationData1.slot);
  const targetEpoch2: int = slotToEpoch(attestationData2.slot);
  return targetEpoch1 === targetEpoch2;
}

/**
 * Check if attestationData1 surrounds attestationData2
 * @param {AttestationData} attestationData1
 * @param {AttestationData} attestationData2
 * @returns {boolean}
 */
export function isSurroundVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const sourceEpoch1: int  = attestationData1.justifiedEpoch;
  const sourceEpoch2: int  = attestationData2.justifiedEpoch;
  const targetEpoch1: int  = slotToEpoch(attestationData1.slot);
  const targetEpoch2: int  = slotToEpoch(attestationData2.slot);
  return (
    (sourceEpoch1 < sourceEpoch2) &&
    (targetEpoch2 < targetEpoch1)
  );
}

/**
 * Calculate the largest integer k such that k**2 <= n.
 * Used in reward/penalty calculations
 * @param {int} n
 * @returns {int}
 */
export function intSqrt(n: int): int {
  let x: int = n;
  let y: int = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

/**
 * An entry or exit triggered in the epoch given by the input takes effect at the epoch given by the output.
 * @param {EpochNumber} epoch
 * @returns {EpochNumber}
 */
export function getEntryExitEffectEpoch(epoch: EpochNumber): EpochNumber {
  return epoch + 1 +ENTRY_EXIT_DELAY;
}
