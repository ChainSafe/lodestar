import { keccakAsU8a } from "@polkadot/util-crypto";
import BN from "bn.js";

import {
  ACTIVATION_EXIT_DELAY,
  GENESIS_EPOCH, LATEST_ACTIVE_INDEX_ROOTS_LENGTH, LATEST_BLOCK_ROOTS_LENGTH, LATEST_RANDAO_MIXES_LENGTH,
  MAX_DEPOSIT_AMOUNT,
  SHARD_COUNT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
} from "../constants";
import {
  AttestationData,
  BeaconState,
  bool,
  bytes,
  bytes32,
  Epoch,
  Fork,
  int,
  Shard,
  SlashableAttestation,
  Slot,
  uint64,
  Validator,
  ValidatorIndex,
} from "../types";

/**
 * Return a byte array from an int
 * @param {BN | number} value
 * @param {number} length
 * @returns {bytes}
 */
export function intToBytes(value: BN | number, length: number): bytes {
  if (BN.isBN(value)) {
    return value.toArrayLike(Buffer, "le", length);
  } else {
    // value is a number
    const b = Buffer.alloc(length);
    // Buffer#writeIntLE can only write at max 6 bytes
    b.writeUIntLE(value, 0, Math.min(length, 6));
    return b;
  }
}

/**
 * Return the epoch number of the given slot.
 * @param {Slot} slot
 * @returns {Epoch}
 */
export function slotToEpoch(slot: Slot): Epoch {
  return slot.divn(SLOTS_PER_EPOCH);
}

/**
 * Return the current epoch of the given state.
 * @param {BeaconState} state
 * @returns {Epoch}
 */
export function getCurrentEpoch(state: BeaconState): Epoch {
  return slotToEpoch(state.slot);
}

/**
 * Return the starting slot of the given epoch.
 * @param {Epoch} epoch
 * @returns {Slot}
 */
export function getEpochStartSlot(epoch: Epoch): Slot {
  return epoch.muln(SLOTS_PER_EPOCH);
}

/**
 * Checks to see if a validator is active.
 * @param {Validator} validator
 * @param {Epoch} epoch
 * @returns {boolean}
 */
export function isActiveValidator(validator: Validator, epoch: Epoch): boolean {
  return validator.activationEpoch.lte(epoch) && epoch.lt(validator.exitEpoch);
}

/**
 * Get indices of active validators from validators.
 * @param {Validator[]} validators
 * @param {Epoch} epoch
 * @returns {ValidatorIndex[]}
 */
export function getActiveValidatorIndices(validators: Validator[], epoch: Epoch): ValidatorIndex[] {
  return validators.reduce((accumulator: ValidatorIndex[], validator: Validator, index: int) => {
    return isActiveValidator(validator, epoch)
    ? [...accumulator, new BN(index)]
    : accumulator;
  }, []);
}

/**
 * The following is a function that shuffles any list; we primarily use it for the validator list.
 * @param {T[]} values
 * @param {bytes32} seed
 * @returns {T[]} Returns the shuffled values with seed as entropy.
 */
function shuffle<T>(values: T[], seed: bytes32): T[] {
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
  let source: bytes32 = seed;
  let index: number = 0;
  while (index < valuesCount - 1) {
    // Re-hash the `source` to obtain a new pattern of bytes.
    source = hash(source); // 32 bytes long

    // Iterate through the `source` bytes in 3-byte chunks.
    for (let position = 0; position < 32 - (32 % randBytes); position += randBytes) {
      // Determine the number of indices remaining in `values` and exit
      // once the last index is reached.
      const remaining: number = valuesCount - index;
      if (remaining === 1) {
        break;
      }
      // Read 3-bytes of `source` as a 24-bit big-endian integer.
      const sampleFromSource: number = source.slice(position, position + randBytes).readUIntBE(0, randBytes);

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
      Math.floor(SHARD_COUNT / SLOTS_PER_EPOCH),
      Math.floor(Math.floor(activeValidatorCount / SLOTS_PER_EPOCH) / TARGET_COMMITTEE_SIZE),
    ),
  ) * SLOTS_PER_EPOCH;
}

/**
 * Shuffles validators into shard committees seeded by seed and slot.
 * @param {bytes32} seed
 * @param {Validator[]} validators
 * @param {int} slot
 * @returns {int[][]}
 */
export function getShuffling(seed: bytes32, validators: Validator[], slot: Slot): ValidatorIndex[][] {
  // Normalizes slot to start of epoch boundary
  const slotAtEpoch = slot.sub(slot.umod(new BN(SLOTS_PER_EPOCH)));

  const activeValidatorIndices = getActiveValidatorIndices(validators, slotAtEpoch);

  const committeesPerSlot = getEpochCommitteeCount(activeValidatorIndices.length);

  // TODO fix below
  // Shuffle
  // const proposedSeed = Buffer.from(slot);
  // const newSeed = seed ^ seedY;
  // const shuffledActiveValidatorIndices = shuffle(activeValidatorIndices, newSeed);
  const shuffledActiveValidatorIndices = shuffle(activeValidatorIndices, seed);

  // Split the shuffle list into SLOTS_PER_EPOCH * committeesPerSlot pieces
  return split(shuffledActiveValidatorIndices, committeesPerSlot * SLOTS_PER_EPOCH);
}

/**
 * Return the number of committees in the previous epoch of the given state.
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getPreviousEpochCommitteeCount(state: BeaconState): int {
  const previousActiveValidators = getActiveValidatorIndices(state.validatorRegistry, state.previousShufflingEpoch);
  return getEpochCommitteeCount(previousActiveValidators.length);
}

/**
 * Gets the current committee count per slot
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getCurrentEpochCommitteeCount(state: BeaconState): int {
  const currentActiveValidators = getActiveValidatorIndices(state.validatorRegistry, state.currentShufflingEpoch);
  return getEpochCommitteeCount(currentActiveValidators.length);
}

/**
 * Get's the next epoch committee count
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getNextEpochCommitteeCount(state: BeaconState): int {
  const nextActiveValidators = getActiveValidatorIndices(state.validatorRegistry, getCurrentEpoch(state).addn(1));
  return getEpochCommitteeCount(nextActiveValidators.length);
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 * @param {BeaconState} state
 * @param {Slot} slot
 * @param {boolean} registryChange
 * @returns {[]}
 */
export function getCrosslinkCommitteesAtSlot(state: BeaconState, slot: Slot, registryChange: boolean = false): Array<{shard: Shard, validatorIndices: ValidatorIndex[]}> {
  const epoch = slotToEpoch(slot);
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = currentEpoch.gt(GENESIS_EPOCH) ? currentEpoch.subn(1) : currentEpoch;
  const nextEpoch = currentEpoch.addn(1);

  if (previousEpoch <= epoch && epoch <= nextEpoch) { throw new Error("Slot is too early!"); }

  // variables
  let committeesPerEpoch: int;
  let seed: bytes32;
  let shufflingEpoch: Epoch;
  let shufflingStartShard: uint64;
  let currentCommitteesPerEpoch: int;

  if (epoch === previousEpoch) {
    committeesPerEpoch = getPreviousEpochCommitteeCount(state);
    seed = state.previousShufflingSeed;
    shufflingEpoch = state.previousShufflingEpoch;
    shufflingStartShard = state.previousShufflingStartShard;
  } else if (epoch === currentEpoch) {
    committeesPerEpoch = getCurrentEpochCommitteeCount(state);
    seed = state.currentShufflingSeed;
    shufflingEpoch = state.currentShufflingEpoch;
    shufflingStartShard = state.currentShufflingStartShard;
  } else if (epoch === nextEpoch) {
    currentCommitteesPerEpoch = getCurrentEpochCommitteeCount(state);
    committeesPerEpoch = getNextEpochCommitteeCount(state);
    shufflingEpoch = nextEpoch;

    const epochsSinceLastRegistryUpdate: BN = currentEpoch.sub(state.validatorRegistryUpdateEpoch);
    if (registryChange) {
      seed = generateSeed(state, nextEpoch);
      shufflingStartShard = (state.currentShufflingStartShard.addn(currentCommitteesPerEpoch)).umod(new BN(SHARD_COUNT));
    } else if (epochsSinceLastRegistryUpdate.gtn(1) && isPowerOfTwo(epochsSinceLastRegistryUpdate)) {
      seed = generateSeed(state, nextEpoch);
      shufflingStartShard = state.currentShufflingStartShard;
    } else {
      seed = state.currentShufflingSeed;
      shufflingStartShard = state.currentShufflingStartShard;
    }
  }

  const shuffling: ValidatorIndex[][] = getShuffling(seed, state.validatorRegistry, shufflingEpoch);
  const offset: int = slot.umod(new BN(SLOTS_PER_EPOCH)).toNumber();
  const committeesPerSlot = Math.floor(committeesPerEpoch / SLOTS_PER_EPOCH);
  const slotStartShard = shufflingStartShard.addn(committeesPerSlot * offset).umod(new BN(SHARD_COUNT));

  return Array.apply(null, Array(committeesPerSlot)).map((x, i) => {
    return {
      committee: shuffling[committeesPerSlot * offset + i],
      shard: (slotStartShard + i) % SHARD_COUNT,
    };
  });
}

/**
 * Retrieves hash for a given beacon block.
 * It should always return the block hash in the beacon chain slot for `slot`.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {bytes32}
 */
export function getBlockRoot(state: BeaconState, slot: Slot): bytes32 {
  // Returns the block root at a recent ``slot``.
  if (state.slot.lte(slot.addn(LATEST_BLOCK_ROOTS_LENGTH))) { throw new Error(); }
  if (slot.lt(state.slot)) { throw new Error(); }
  return state.latestBlockRoots[slot.umod(new BN(LATEST_BLOCK_ROOTS_LENGTH)).toNumber()];
}

/**
 * Return the randao mix at a recent epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
export function getRandaoMix(state: BeaconState, epoch: Epoch): bytes32 {
  if (getCurrentEpoch(state).subn(LATEST_RANDAO_MIXES_LENGTH).lt(epoch) && epoch.lt(getCurrentEpoch(state))) { throw new Error(""); }
  return state.latestRandaoMixes[epoch.umod(new BN(LATEST_RANDAO_MIXES_LENGTH)).toNumber()];
}

/**
 * Return the index root at a recent epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
export function getActiveIndexRoot(state: BeaconState, epoch: Epoch): bytes32 {
  if (getCurrentEpoch(state).subn(LATEST_ACTIVE_INDEX_ROOTS_LENGTH + ACTIVATION_EXIT_DELAY).lt(epoch)
      && epoch.lt(getCurrentEpoch(state).addn(ACTIVATION_EXIT_DELAY))) { throw new Error(""); }
  return state.latestActiveIndexRoots[epoch.umod(new BN(LATEST_ACTIVE_INDEX_ROOTS_LENGTH)).toNumber()];
}

/**
 * Generate a seed for the given epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
// TODO FINSIH
export function generateSeed(state: BeaconState, epoch: Epoch): bytes32 {
  // return hash(
  //   getRandaoMix(state, epoch - MIN_SEED_LOOKAHEAD) + getActiveIndexRoot(state, epoch))
  // )
  return Buffer.alloc(1);
}

/**
 * Return the beacon proposer index for the slot.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {int}
 */
export function getBeaconProposerIndex(state: BeaconState, slot: Slot): int {
  const firstCommittee = getCrosslinkCommitteesAtSlot(state, slot)[0].validatorIndices;
  return firstCommittee[slot.umod(new BN(firstCommittee.length)).toNumber()].toNumber();
}

// This function was copied from ssz-js
// TODO: either export hash from ssz-js or move to a util-crypto library
export function hash(value: bytes): bytes32 {
  return Buffer.from(keccakAsU8a(value));
}

/**
 * Merkleize values where the length of values is a power of two and return the Merkle root.
 * @param {bytes32[]} values
 * @returns {bytes32}
 */
export function merkleRoot(values: bytes32[]): bytes32 {
  // Create array twice as long as values
  // first half of the array representing intermediate tree nodes
  const o: bytes[] = Array.from({ length: values.length },
    () => Buffer.alloc(0))
      // do not hash leaf nodes
      // we assume leaf nodes are prehashed
      .concat(values);
  for (let i = values.length - 1; i > 0; i--) {
    // hash intermediate/root nodes
    o[i] = hash(Buffer.concat([o[i * 2], o[i * 2 + 1]]));
  }
  return o[1];
}

// // TODO finish
export function getAttestationParticipants(state: BeaconState, attestationData: AttestationData, participationBitfield: bytes): int[] {
   return [];
}
// export function getAttestationParticipants(state: BeaconState, attestationData: AttestationData, participationBitfield: bytes): int[] {
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
export function isPowerOfTwo(value: BN): boolean {
  if (value.ltn(0)) {
    throw new Error("Value is negative!");
  } else if (value.eqn(0)) {
    return false;
  } else {
    // a power of two has only one bit set
    let hasBitSet: boolean = false;
    for (let i = 0; i < value.bitLength(); i++) {
      if (hasBitSet) {
        return false;
      }
      hasBitSet = value.testn(i);
    }
    return true;
  }
}

/**
 * Determine the balance of a validator.
 * @param {BeaconState} state
 * @param {int} index
 * @returns {Number}
 */
export function getEffectiveBalance(state: BeaconState, index: int): int {
  // Returns the effective balance (also known as "balance at stake") for a ``validator`` with the given ``index``.
  if (state.validatorBalances[index].ltn(MAX_DEPOSIT_AMOUNT)) {
    return state.validatorBalances[index].toNumber();
  } else {
    return MAX_DEPOSIT_AMOUNT;
  }
}

/**
 * Return the fork version of the given epoch.
 * @param {Fork} fork
 * @param {Epoch} epoch
 * @returns {Number}
 */
export function getForkVersion(fork: Fork, epoch: Epoch): uint64 {
  return epoch.lt(fork.epoch) ? fork.previousVersion : fork.currentVersion;
}

/**
 * Get the domain number that represents the fork meta and signature domain.
 * @param {Fork} fork
 * @param {Epoch} epoch
 * @param {int} domainType
 * @returns {Number}
 */
export function getDomain(fork: Fork, epoch: Epoch, domainType: int): uint64 {
  return getForkVersion(fork, epoch).mul(new BN(2 ** 32)).addn(domainType);
}

/**
 * Returns the ith bit in bitfield
 * @param {bytes} bitfield
 * @param {int} i
 * @returns {Number}
 */
export function getBitfieldBit(bitfield: bytes, i: int): int {
  const bit = i % 8;
  const byte = Math.floor(i / 8);
  return (bitfield[byte] >> bit) & 1;
}

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
  const targetEpoch1: Epoch = slotToEpoch(attestationData1.slot);
  const targetEpoch2: Epoch = slotToEpoch(attestationData2.slot);
  return targetEpoch1.eq(targetEpoch2);
}

/**
 * Check if attestationData1 surrounds attestationData2
 * @param {AttestationData} attestationData1
 * @param {AttestationData} attestationData2
 * @returns {boolean}
 */
export function isSurroundVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const sourceEpoch1: Epoch  = attestationData1.justifiedEpoch;
  const sourceEpoch2: Epoch  = attestationData2.justifiedEpoch;
  const targetEpoch1: Epoch  = slotToEpoch(attestationData1.slot);
  const targetEpoch2: Epoch  = slotToEpoch(attestationData2.slot);
  return (
    sourceEpoch1.lt(sourceEpoch2) &&
    targetEpoch2.lt(targetEpoch1)
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
 * @param {Epoch} epoch
 * @returns {Epoch}
 */
export function getEntryExitEffectEpoch(epoch: Epoch): Epoch {
  return epoch.addn(1 + ACTIVATION_EXIT_DELAY);
}

// TODO finish
/**
 * Slash the validator with index ``index``.
 * Note that this function mutates ``state``.
 * @param {BeaconState} state
 * @param {ValidatorIndex} index
 */
export function slashValidator(state: BeaconState, index: ValidatorIndex) {
  return;
}

// TODO finish
/**
 * Verify validity of ``slashable_attestation`` fields.
 * @param {BeaconState} state
 * @param {SlashableAttestation} slashableAttesation
 * @returns {bool}
 */
export function verifySlashableAttestation(state: BeaconState, slashableAttestation: SlashableAttestation): bool {
  return true;
}

// TODO finish
/**
 * Verify that the given ``leaf`` is on the merkle branch ``branch``.
 */
export function verifyMerkleBranch(leaf: bytes32, branch: bytes32[], depth: int, index: int, root: bytes32): bool {
  return true;
}
