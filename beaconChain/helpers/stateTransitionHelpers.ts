import { keccakAsU8a } from "@polkadot/util-crypto";
// Helper functions related to state transition functions
import {
  EPOCH_LENGTH, GWEI_PER_ETH, LATEST_BLOCK_ROOTS_LENGTH, MAX_CASPER_SLASHINGS, MAX_CASPER_VOTES, MAX_DEPOSIT,
  SHARD_COUNT,
  TARGET_COMMITTEE_SIZE,
} from "../constants/constants";
import {AttestationData, BeaconBlock, SlashableVoteData} from "../interfaces/blocks";
import {BeaconState, CommitteeShard, ForkData, ShardCommittee, ValidatorRecord} from "../interfaces/state";

type int = number;
type bytes = number;
type uint24 = number;
type hash32 = Uint8Array;

/**
 * Checks to see if a validator is active.
 * @param {ValidatorRecord} validator
 * @param {int} slot
 * @returns {boolean}
 */
export function isActiveValidator(validator: ValidatorRecord, slot: int): boolean {
  return validator.activationSlot <= slot && slot < validator.exitSlot;
}

/**
 * The following is a function that gets active validator indices from the validator list.
 * @param {ValidatorRecord[]} validators
 * @returns {int[]}
 */
export function getActiveValidatorIndices(validators: ValidatorRecord[], slot: int): int[] {
  return validators.reduce((accumulator: int[], validator: ValidatorRecord, index: int) => {
    return isActiveValidator(validator, slot)
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
function shuffle<T>(values: T[], seed: hash32): T[] {
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
      } else {
        // The sample causes modulo bias. A new sample should be read.
        // index = index
      }
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
  // Returns the split ``seq`` in ``split_count`` pieces in protocol.
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
 * Gets the number of committees per slot.
 * @param {int} activeValidatorCount
 * @returns {Number}
 */
export function getCommitteeCountPerSlot(activeValidatorCount: int): int {
  return Math.max(
    1,
    Math.min(
      Math.floor(SHARD_COUNT / EPOCH_LENGTH),
      Math.floor(Math.floor(activeValidatorCount / EPOCH_LENGTH) / TARGET_COMMITTEE_SIZE)
    )
  )
}

/**
 * Shuffles validators into shard committees seeded by seed and slot.
 * @param {hash32} seed
 * @param {ValidatorRecord[]} validators
 * @param {int} crosslinkingStartShard
 * @returns {ShardCommittee[][]} List of EPOCH_LENGTH * committeesPerSlot committees where each committee is itself a list of validator indices.
 */
export function getShuffling(seed: hash32, validators: ValidatorRecord[], slot: int): int[][] {
  // Normalizes slot to start of epoch boundary
  slot -= slot % EPOCH_LENGTH;

  const activeValidatorIndices = getActiveValidatorIndices(validators, slot);

  const committeesPerSlot = getCommitteeCountPerSlot(activeValidatorIndices.length);

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
 * Gets the previous committee count per slot
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getPreviousEpochCommitteeCountPerSlot(state: BeaconState): int {
  const previousActiveValidators = getActiveValidatorIndices(state.validatorRegistry, state.previousEpochCalculationSlot);
  return getCommitteeCountPerSlot(previousActiveValidators.length);
}

/**
 * Gets the current committee count per slot
 * @param {BeaconState} state
 * @returns {Number}
 */
export function getCurrentEpochCommitteeCountPerSlot(state: BeaconState): int {
  const currentActiveValidators = getActiveValidatorIndices(state.validatorRegistry, state.previousEpochCalculationSlot);
  return getCommitteeCountPerSlot(currentActiveValidators.length);
}

/**
 * Returns the list of (committee, shard) tuples for the slot
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {ShardCommittee[]}
 */
function getCrosslinkCommitteesAtSlot(state: BeaconState, slot: int): CommitteeShard[] {
  const earliestSlot = state.slot - (state.slot % EPOCH_LENGTH) - EPOCH_LENGTH;

  if (earliestSlot <= slot && slot < (earliestSlot + EPOCH_LENGTH * 2)) throw new Error("Slot is too early!");

  const offset = slot % EPOCH_LENGTH;

  let slotStartShard: int;
  let committeesPerSlot: int;
  let shuffling: int[][];

  if (slot < earliestSlot + EPOCH_LENGTH) {
    committeesPerSlot = getPreviousEpochCommitteeCountPerSlot(state);
    shuffling = getShuffling(
      state.previousEpochRandaoMix,
      state.validatorRegistry,
      state.previousEpochCalculationSlot
    );
    slotStartShard = (state.currentEpochStartShard + committeesPerSlot * offset) % SHARD_COUNT;
  } else {
    const committeesPerSlot = getCurrentEpochCommitteeCountPerSlot(state);
    shuffling = getShuffling(
      state.currentEpochRandaoMix,
      state.validatorRegistry,
      state.currentEpochCalculationSlot
    );
    slotStartShard = (state.currentEpochStartShard + committeesPerSlot * offset) % SHARD_COUNT;
  }

  let returnValues: CommitteeShard[];
  for (let i: number = 0; i < committeesPerSlot; i++) {
    const committeeShard: CommitteeShard = {
      committee: shuffling[committeesPerSlot * offset + i],
      shard: (slotStartShard + i) % SHARD_COUNT
    };
    returnValues.push(committeeShard);
  }
  return returnValues;
}

/**
 * Retrieves hash for a given beacon block.
 * It should always return the block hash in the beacon chain slot for `slot`.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {hash32}
 */
function getBlockRoot(state: BeaconState, slot: int): hash32 {
  // Returns the block root at a recent ``slot``.
  if (state.slot <= slot + LATEST_BLOCK_ROOTS_LENGTH) { throw new Error(); }
  if (slot < state.slot) { throw new Error(); }
  return state.latestBlockRoots[slot % LATEST_BLOCK_ROOTS_LENGTH];
}

/**
 * Determines the proposer of a beacon block.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {int}
 */
export function getBeaconProposerIndex(state: BeaconState, slot: int): int {
  const firstCommittee = getCrosslinkCommitteesAtSlot(state, slot)[0].committee;
  return firstCommittee[slot % firstCommittee.length];
}

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
//   // TODO Figure out why this is an error
//   // TODO implement error based on python pseudo code
//   // TODO what is ceil_div8()
//   // assert len(participation_bitfield) == ceil_div8(len(snc.committee))
//
//   const participants: int[] = shardCommittee.committee.filter((validator: uint24, index: int) => {
//     const bit: int = (participationBitfield[Math.floor(index / 8)] >> (7 - (index % 8))) % 2;
//     return bit === 1;
//   });
//   return participants;
// }

/**
 * Determine the balance of a validator.
 * Used for determining punishments and calculating stake.
 * @param {ValidatorRecord} validator
 * @returns {int}
 */
export function getEffectiveBalance(state: BeaconState, index: int): int {
  // Returns the effective balance (also known as "balance at stake") for a ``validator`` with the given ``index``.
  return Math.min(state.validatorBalances[index], MAX_DEPOSIT * GWEI_PER_ETH);
}

/**
 * Returns the current fork vesion
 * @param {ForkData} forkData
 * @param {int} slot
 * @returns {Number}
 */
export function getForkVersion(forkData: ForkData, slot: int): int {
  return slot < forkData.forkSlot ? forkData.preForkVersion : forkData.postForkVersion;
}

/**
 * Returns the domain
 * @param {ForkData} forkData
 * @param {int} slot
 * @param {int} domainType
 * @returns {Number}
 */
export function getDomain(forkData: ForkData, slot: int, domainType: int): int {
  return (getForkVersion(forkData, slot) * 2**32) + domainType
}

export function verifySlashableVoteData(state: BeaconState, voteData: SlashableVoteData): boolean {
  if ((voteData.custodyBit0Indices).length + voteData.custodyBit1Indices.length > MAX_CASPER_VOTES) {
    return false;
  }
  // TODO Stubbed waiting for BLS
//   return bls_verify_multiple(
//     pubkeys=[
//       aggregate_pubkey([state.validators[i].pubkey for i in vote_data.custody_bit_0_indices]),
//     aggregate_pubkey([state.validators[i].pubkey for i in vote_data.custody_bit_1_indices]),
// ],
//   messages=[
//     hash_tree_root(AttestationDataAndCustodyBit(vote_data.data, False)),
//     hash_tree_root(AttestationDataAndCustodyBit(vote_data.data, True)),
//   ],
//     signature=vote_data.aggregate_signature,
//     domain=get_domain(
//       state.fork_data,
//       state.slot,
//       DOMAIN_ATTESTATION,
//     ),
}

/**
 * Assume attestationData1 is distinct form attestationdata2.
 * Returns true if the provided AttestationData are slashable due to a double vote.
 * @param {AttestationData} attestationData1
 * @param {AttestationData} attestationData2
 * @returns {boolean}
 */
export function isDoubleVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const targetEpoch1: int = Math.floor(attestationData1.slot / EPOCH_LENGTH);
  const targetEpoch2: int = Math.floor(attestationData2.slot / EPOCH_LENGTH);
  return targetEpoch1 === targetEpoch2;
}

/**
 * Assumes attestationData1 is distinct from attestationData2.
 * Returns True if the provided AttestationData are slashable due to a surround vote.
 * Note: paramater order matters as this function only checks that attestationData1 surrounds attestationData2.
 * @param {AttestationData} attestationData1
 * @param {AttestationData} attestationData2
 * @returns {boolean}
 */
export function isSurroundVote(attestationData1: AttestationData, attestationData2: AttestationData): boolean {
  const sourceEpoch1: int  = Math.floor(attestationData1.justifiedSlot / EPOCH_LENGTH);
  const sourceEpoch2: int  = Math.floor(attestationData2.justifiedSlot / EPOCH_LENGTH);
  const targetEpoch1: int  = Math.floor(attestationData1.slot / EPOCH_LENGTH);
  const targetEpoch2: int  = Math.floor(attestationData2.slot / EPOCH_LENGTH);
  return (
    (sourceEpoch1 < sourceEpoch2) &&
    (sourceEpoch2 + 1 === targetEpoch2) &&
    (targetEpoch2 < targetEpoch1)
  )
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
