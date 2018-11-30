// // Helper functions related to state transition functions
// // TODO convert Number (in return value for getActiveValidatorIndeces) to and number
//
// import {BeaconState, ShardAndCommittee, ValidatorRecord} from "../numbererfaces/state";
// import { ValidatorStatusCodes } from "../constants/enums";
// import constants from "../constants/constants"
// import {AttestationSignedData, BeaconBlock} from "../numbererfaces/blocks";
//
// /**
//  * The following is a function that gets active validator indices from the validator list.
//  * @param {ValidatorRecord[]} validators
//  * @returns {Number[]}
//  */
// // TODO Need to setup the enums to perform a proper comparison
// function getActiveValidatorIndices(validators: ValidatorRecord[]): Number[] {
//   return validators.filter((validator: ValidatorRecord, index: number) => {
//     // Check if validator status is set ACTIVE
//     if (validator.status === ValidatorStatusCodes.ACTIVE) return index;
//   })
// }
//
// /**
//  * The following is a function that shuffles any list; we primarily use it for the validator list.
//  * @param {any[]} values
//  * @param {Hash32} seed
//  * @returns Returns the shuffled values with seed as entropy.
//  */
// // TODO finish this
// function shuffle(values: any[], seed: Hash32): any[] {
//   const valuesCount: number = values.length;
//   // Entropy is consumed from the seed in 3-byte (24 bit) chunks.
//   const randBytes = 3;
//   // Highest possible result of the RNG
//   const randMax = 2 ** (randBytes * 8) - 1;
//
//   // The range of the RNG places an upper-bound on the size of the list that may be shuffled.
//   // It is a logic error to supply an oversized list.
//   if (valuesCount < randMax) throw new Error("Oversized list supplied to shuffle()!");
//
//   // Make a copy of the values
//   let output = values.slice();
//   const source = seed; // REALLY??
//   let index = 0; // REALLY??
//   while (index < valuesCount -1) {
//     // Re-hash the `source` to obtain a new pattern of bytes.
//     // TODO figure out what this hash function is in python -> JS
//     let source = hash(source)
//
//     // Iterate through the `source` bytes in 3-byte chunks.
//
//   }
//
//   return []
// }
//
// /**
//  * Splits a list numbero split_count pieces.
//  * @param {any[]} values
//  * @param {Number} splitCount
//  * @returns {any[]}
//  */
export function split(values: any[], splitCount: number): any[] {
  // Returns the split ``seq`` in ``split_count`` pieces in protocol.
  const listLength = values.length;
  let array: any[] = [];
  for (let i = 0; i < splitCount; i++) {
    array.push(values.slice(
      Math.floor((listLength * i) / splitCount), Math.floor((listLength * (i + 1)) / splitCount)
    ));
  }
  return array;
}

/**
 * Helper function for readability.
 * @param {number} minval
 * @param {number} maxval
 * @param {number} x
 * @returns {Number}
 */
export function clamp(minval: number, maxval: number, x: number): number {
  if (x <= minval) {
    return minval;
  }
  else if (x >= maxval) {
    return maxval
  }
  return x;
}
//
// /**
//  * Determines the shards and committee for a given beacon block.
//  * Should not change unless the validator set changes.
//  * @param {BeaconState} state
//  * @param {number} slot
//  * @returns {ShardAndCommittee[] | Error}
//  */
// function getShardsAndCommitteesForSlot(state: BeaconState, slot: number): ShardAndCommittee[] {
//   const earliestSlotInArray: number = state.lastStateRecalculationSlot - constants.CYCLE_LENGTH;
//   // TODO Figure out why this is an error
//   if (earliestSlotInArray <= slot < earliestSlotInArray + constants.CYCLE_LENGTH * 2) throw new Error();
//   return state.shardAndCommitteeForSlots[slot - earliestSlotInArray];
// }
//
// /**
//  * Retrieves hash for a given beacon block.
//  * It should always return the block hash in the beacon chain slot for `slot`.
//  * @param {BeaconState} state
//  * @param {BeaconBlock} currentBlock
//  * @param {number} slot
//  * @returns {Hash32}
//  */
// function getBlockHash(state: BeaconState, currentBlock: BeaconBlock, slot: number): Hash32 {
//   const earliestSlotInArray = currentBlock.slot - state.recentBlockHashes.length;
//   // TODO Figure out why this is an error
//   if (earliestSlotInArray <= slot < currentBlock.slot) throw new Error();
//   return state.recentBlockHashes[slot - earliestSlotInArray];
// }
//
// /**
//  * Determines the proposer of a beacon block.
//  * @param {BeaconState} state
//  * @param {number} slot
//  * @returns {Number}
//  */
// function getBeaconProposerIndex(state: BeaconState, slot: number): number {
//   const firstCommittee = getShardsAndCommitteesForSlot(state, slot)[0].committee;
//   return firstCommittee[slot % firstCommittee.length];
// }
//
// // TODO finish
// function getAttestationParticipants(state: BeaconState, attestationData: AttestationSignedData, participationBitfield: bytes): number[] {
//   const sncsForSlot: ShardAndCommittee[] = getShardsAndCommitteesForSlot(state, attestationData.slot);
//   const snc: ShardAndCommittee = sncsForSlot.filter((x: ShardAndCommittee) => {
//     if (x.shard === attestationData.shard) return x;
//   })[0];
//
//   // TODO Figure out why this is an error
//   // TODO implement error based on python pseudo code
//   // TODO what is ceil_div8()
//   // assert len(participation_bitfield) == ceil_div8(len(snc.committee))
//
//   const participants: number[] = snc.committee.filter((validator: 'unumber24', index: number) => {
//     const bit = (participationBitfield[Math.floor(index / 8)] >> (7 - (index % 8))) % 2;
//     if (bit === 1) {
//       return index;
//     }
//   });
//   return participants;
// }
//
// /**
//  * Determine the balance of a validator.
//  * Used for determining punishments and calculating stake.
//  * @param {ValidatorRecord} validator
//  * @returns {Number}
//  */
// // TODO Math.min requires number, validator.record is a unumber64
// function balanceAtStake(validator: ValidatorRecord): number {
//   return Math.min(validator.balance, constants.DEPOSIT_SIZE);
// }
//
// // TODO figure out what bytes1() does in python
// function getNewValidatorSetDeltaHashChain(currentValidator: hash32, index: number, pubkey: number, flag: number): hash32 {
//   return newValidatorSetDeltaHashChain = hash(
//     currentValidator + bytes1(flag) + bytes3(index) + bytes32(pubkey)
//   )
// }
//
// /**
//  * Calculate the largest numbereger k such that k**2 <= n.
//  * Used in reward/penalty calculations
//  * @param {number} n
//  * @returns {Number}
//  */
// // TODO Can use built in JS function if available
// function numberSqrt(n: number): number {
//   let x = n;
//   let y = Math.floor((x + 1) / 2);
//   while (y < x) {
//     x = y;
//     y = Math.floor(x + Math.floor(n / x) / 2)
//   }
//   return x;
// }
//
