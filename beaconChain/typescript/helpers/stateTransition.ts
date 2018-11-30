// Helper functions related to state transition functions
// TODO convert Number (in return value for getActiveValidatorIndeces) to and Int

import {BeaconState, ShardAndCommittee, ValidatorRecord} from "../interfaces/state";
import { ValidatorStatusCodes } from "../constants/enums";
import constants from "../constants/constants"
import {AttestationSignedData, BeaconBlock} from "../interfaces/blocks";

/**
 * The following is a function that gets active validator indices from the validator list.
 * @param {ValidatorRecord[]} validators
 * @returns {Number[]}
 */
// TODO Need to setup the enums to perform a proper comparison
function getActiveValidatorIndices(validators: ValidatorRecord[]): Number[] {
  return [validators.filter((validator: ValidatorRecord, index: number) => {
    // Check if validator status is set ACTIVE
    if (validator.status === ValidatorStatusCodes.ACTIVE) return index;
  })]
}

/**
 * The following is a function that shuffles any list; we primarily use it for the validator list.
 * @param {Any[]} values
 * @param {Hash32} seed
 * @returns Returns the shuffled values with seed as entropy.
 */
// TODO finish this
function shuffle(values: Any[], seed: Hash32): Any[] | Error {
  const valuesCount: number = values.length;
  // Entropy is consumed from the seed in 3-byte (24 bit) chunks.
  const randBytes = 3;
  // Highest possible result of the RNG
  const randMax = 2 ** (randBytes * 8) - 1;

  // The range of the RNG places an upper-bound on the size of the list that may be shuffled.
  // It is a logic error to supply an oversized list.
  if (valuesCount < randMax) return new Error("Oversized list supplied to shuffle()!");

  // Make a copy of the values
  let output = values.slice();
  const source = seed; // REALLY??
  let index = 0; // REALLY??
  while (index < valuesCount -1) {
    // Re-hash the `source` to obtain a new pattern of bytes.
    // TODO figure out what this hash function is in python -> JS
    let source = hash(source)

    // Iterate through the `source` bytes in 3-byte chunks.

  }

  return []
}

/**
 * Splits a list into split_count pieces.
 * @param {Any[]} seq
 * @param {Number} splitCount
 * @returns {Any[]}
 */
// TODO finish this
function split(seq: Any[], splitCount: int): Any[] {
  // Returns the split ``seq`` in ``split_count`` pieces in protocol.
  const listLength = seq.length;
  seq
  return []
}

/**
 * Helper function for readability.
 * @param {int} minval
 * @param {int} maxval
 * @param {int} x
 * @returns {Number}
 */
function clamp(minval: int, maxval: int, x: int): int {
  if (x <= minval) {
    return minval;
  }
  else if (x >= maxval) {
    return maxval
  }
  return x;
}

/**
 * Determines the shards and committee for a given beacon block.
 * Should not change unless the validator set changes.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {ShardAndCommittee[] | Error}
 */
function getShardsAndCommitteesForSlot(state: BeaconState, slot: int): ShardAndCommittee[] | Error {
  const earliestSlotInArray = state.lastStateRecalculationSlot - constants.CYCLE_LENGTH;
  // TODO Figure out why this is an error
  if (earliestSlotInArray <= slot < earliestSlotInArray + constants.CYCLE_LENGTH * 2) return new Error();
  return state.shardAndCommitteeForSlots[slot - earliestSlotInArray];
}

/**
 * Retrieves hash for a given beacon block.
 * It should always return the block hash in the beacon chain slot for `slot`.
 * @param {BeaconState} state
 * @param {BeaconBlock} currentBlock
 * @param {int} slot
 * @returns {Hash32 | Error}
 */
function getBlockHash(state: BeaconState, currentBlock: BeaconBlock, slot: int): Hash32 | Error {
  const earliestSlotInArray = currentBlock.slot - state.recentBlockHashes.length;
  // TODO Figure out why this is an error
  if (earliestSlotInArray <= slot < currentBlock.slot) return new Error();
  return state.recentBlockHashes[slot - earliestSlotInArray];
}

/**
 * Determines the proposer of a beacon block.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {Number}
 */
function getBeaconProposerIndex(state: BeaconState, slot: int): int {
  const firstCommittee = getShardsAndCommitteesForSlot(state, slot)[0].committee;
  return firstCommittee[slot % firstCommittee.length];
}

// TODO finish
function getAttestationParticipants(state: BeaconState, attestationData: AttestationSignedData, attesterBitfield: bytes): int[] {
  const sncsForSlot = getShardsAndCommitteesForSlot(state, attestationData.slot);
  // TODO ask about this... theres is no arrary returned from sncsForSlot, so how does one run a for loop?
  // Python code:::
  // snc = [x for x in sncs_for_slot if x.shard == attestation_data.shard][0]

  const snc = [sncsForSlot.];
}

/**
 * Determine the balance of a validator.
 * Used for determining punishments and calculating stake.
 * @param {ValidatorRecord} validator
 * @returns {Number}
 */
// TODO Math.min requires number, validator.record is a uint64
function balanceAtStake(validator: ValidatorRecord): int {
  return Math.min(validator.balance, constants.DEPOSIT_SIZE);
}

// TODO figure out what bytes1() does in python
function getNewValidatorSetDeltaHashChain(currentValidator: hash32, index: int, pubkey: int, flag: int): hash32 {
  return newValidatorSetDeltaHashChain = hash(
    currentValidator + bytes1(flag) + bytes3(index) + bytes32(pubkey)
  )
}

/**
 * Calculate the largest integer k such that k**2 <= n.
 * Used in reward/penalty calculations
 * @param {int} n
 * @returns {Number}
 */
// NOTE Can use built in JS function if available
function intSqrt(n: int): int {
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor(x + Math.floor(n / x) / 2)
  }
  return x;
}

