import { keccakAsU8a } from "@polkadot/util-crypto";
import BN from "bn.js";
import { hashTreeRoot } from "@chainsafe/ssz";
import assert from "assert";


import {
  ACTIVATION_EXIT_DELAY,
  Domain,
  EMPTY_SIGNATURE,
  FAR_FUTURE_EPOCH,
  GENESIS_EPOCH,
  LATEST_ACTIVE_INDEX_ROOTS_LENGTH,
  LATEST_BLOCK_ROOTS_LENGTH,
  LATEST_RANDAO_MIXES_LENGTH,
  MAX_DEPOSIT_AMOUNT,
  MAX_INDICES_PER_SLASHABLE_VOTE,
  MIN_SEED_LOOKAHEAD,
  SHARD_COUNT,
  SLOTS_PER_EPOCH,
  TARGET_COMMITTEE_SIZE,
  ZERO_HASH,
} from "../../constants";

import {
  AttestationData,
  AttestationDataAndCustodyBit,
  BLSPubkey,
  BLSSignature,
  BeaconState,
  bool,
  bytes,
  bytes32,
  CrosslinkCommittee,
  DepositInput,
  Epoch,
  Fork,
  Gwei,
  int,
  Shard,
  SlashableAttestation,
  Slot,
  uint64,
  Validator,
  ValidatorIndex,
  number64,
} from "../../types";

import {
  blsAggregatePubkeys,
  blsVerifyMultiple,
  blsVerify,
} from "../../stubs/bls";


// This function was copied from ssz-js
// TODO: either export hash from ssz-js or move to a util-crypto library
export function hash(value: bytes): bytes32 {
  return Buffer.from(keccakAsU8a(value));
}

/**
 * Return a byte array from an int
 * @param {BN | number} value
 * @param {number} length
 * @returns {bytes}
 */
export function intToBytes(value: BN | number, length: number): bytes {
  if (BN.isBN(value)) { // value is BN
    return value.toArrayLike(Buffer, "le", length);
  } else if (length <= 6) { // value is a number and length is at most 6 bytes
    const b = Buffer.alloc(length);
    b.writeUIntLE(value, 0, length);
    return b;
  } else { // value is number and length is too large for Buffer#writeUIntLE
    value = new BN(value)
    return value.toArrayLike(Buffer, "le", length);
  }
}

/**
 * Return the epoch number of the given slot.
 * @param {Slot} slot
 * @returns {Epoch}
 */
export function slotToEpoch(slot: Slot): Epoch {
  return Math.floor(slot / SLOTS_PER_EPOCH);
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
 * Return the previous epoch of the given state.
 * @param {BeaconState} state
 * @returns {Epoch}
 */
export function getPreviousEpoch(state: BeaconState): Epoch {
  const currentEpoch = getCurrentEpoch(state);
  if (currentEpoch == GENESIS_EPOCH) {
    return GENESIS_EPOCH;
  }
  return currentEpoch - 1;
}

/**
 * Return the starting slot of the given epoch.
 * @param {Epoch} epoch
 * @returns {Slot}
 */
export function getEpochStartSlot(epoch: Epoch): Slot {
  return epoch * SLOTS_PER_EPOCH;
}

/**
 * Checks to see if a validator is active.
 * @param {Validator} validator
 * @param {Epoch} epoch
 * @returns {boolean}
 */
export function isActiveValidator(validator: Validator, epoch: Epoch): boolean {
  return validator.activationEpoch <= epoch && epoch < validator.exitEpoch;
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
      ? [...accumulator, index]
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
  const randBytes = 3;
  // Highest possible result of the RNG
  const randMax: number = 2 ** (randBytes * 8) - 1;

  // The range of the RNG places an upper-bound on the size of the list that may be shuffled.
  // It is a logic error to supply an oversized list.
  if (!(valuesCount < randMax)) { throw new Error("Oversized list supplied to shuffle!"); }

  // Make a copy of the values
  const output: T[] = values.slice();
  let source: bytes32 = seed;
  let index = 0;
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
  const slotAtEpoch = slot - slot % SLOTS_PER_EPOCH;

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
  const nextActiveValidators = getActiveValidatorIndices(state.validatorRegistry, getCurrentEpoch(state) + 1);
  return getEpochCommitteeCount(nextActiveValidators.length);
}

/**
 * Return the randao mix at a recent epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
export function getRandaoMix(state: BeaconState, epoch: Epoch): bytes32 {
  assert((getCurrentEpoch(state) - LATEST_RANDAO_MIXES_LENGTH) < epoch && epoch < getCurrentEpoch(state))
  return state.latestRandaoMixes[epoch % LATEST_RANDAO_MIXES_LENGTH];
}

/**
 * Return the index root at a recent epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
export function getActiveIndexRoot(state: BeaconState, epoch: Epoch): bytes32 {
  if (getCurrentEpoch(state) - (LATEST_ACTIVE_INDEX_ROOTS_LENGTH + ACTIVATION_EXIT_DELAY) < epoch
    && epoch < (getCurrentEpoch(state) + ACTIVATION_EXIT_DELAY)) { throw new Error(""); }
  return state.latestActiveIndexRoots[epoch % LATEST_ACTIVE_INDEX_ROOTS_LENGTH];
}

/**
 * Generate a seed for the given epoch.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
export function generateSeed(state: BeaconState, epoch: Epoch): bytes32 {
  return hash(Buffer.concat([
    getRandaoMix(state, epoch - MIN_SEED_LOOKAHEAD),
    getActiveIndexRoot(state, epoch),
  ]))
}

/**
 * Check if value is a power of two integer.
 * @param {number} value
 * @returns {boolean}
 */
export function isPowerOfTwo(value: number): boolean {
  if (value < 0) {
    throw new Error("Value is negative!");
  } else if (value === 0) {
    return false;
  } else {
    let n = value;
    // A power of two only has one bit set
    while (n != 1) {
      if (n % 2 != 0) {
        return false;
      }
      n /= 2;
    }
    return true;
  }
}

/**
 * Return the list of (committee, shard) acting as a tuple for the slot.
 * @param {BeaconState} state
 * @param {Slot} slot
 * @param {boolean} registryChange
 * @returns {[]}
 */
export function getCrosslinkCommitteesAtSlot(state: BeaconState, slot: Slot, registryChange: boolean = false): CrosslinkCommittee[] {
  const epoch = slotToEpoch(slot);
  const currentEpoch = getCurrentEpoch(state);
  const previousEpoch = currentEpoch > GENESIS_EPOCH ? currentEpoch - 1 : currentEpoch;
  const nextEpoch = currentEpoch + 1;

  if (previousEpoch <= epoch && epoch <= nextEpoch) { throw new Error("Slot is too early!"); }

  // variables
  let committeesPerEpoch: int;
  let seed: bytes32;
  let shufflingEpoch: Epoch;
  let shufflingStartShard: Shard;
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

    const epochsSinceLastRegistryUpdate = currentEpoch - state.validatorRegistryUpdateEpoch;
    if (registryChange) {
      seed = generateSeed(state, nextEpoch);
      shufflingStartShard = (state.currentShufflingStartShard + currentCommitteesPerEpoch) % SHARD_COUNT;
    } else if (epochsSinceLastRegistryUpdate > 1 && isPowerOfTwo(epochsSinceLastRegistryUpdate)) {
      seed = generateSeed(state, nextEpoch);
      shufflingStartShard = state.currentShufflingStartShard;
    } else {
      seed = state.currentShufflingSeed;
      shufflingStartShard = state.currentShufflingStartShard;
    }
  }

  const shuffling: ValidatorIndex[][] = getShuffling(seed, state.validatorRegistry, shufflingEpoch);
  const offset = slot % SLOTS_PER_EPOCH;
  const committeesPerSlot = Math.floor(committeesPerEpoch / SLOTS_PER_EPOCH);
  const slotStartShard = (shufflingStartShard + (committeesPerSlot * offset))  % SHARD_COUNT;

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
  assert(state.slot <= slot + LATEST_BLOCK_ROOTS_LENGTH);
  assert(slot < state.slot);
  return state.latestBlockRoots[slot % LATEST_BLOCK_ROOTS_LENGTH];
}

/**
 * Return the beacon proposer index for the slot.
 * @param {BeaconState} state
 * @param {int} slot
 * @returns {int}
 */
export function getBeaconProposerIndex(state: BeaconState, slot: Slot): int {
  const firstCommittee = getCrosslinkCommitteesAtSlot(state, slot)[0].validatorIndices;
  return firstCommittee[slot % firstCommittee.length];
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// export function getAttestationParticipants(state: BeaconState, attestationData: AttestationData, participationBitfield: bytes): int[] {
//   const crosslinkCommittee: CommitteeShard[] = getCrosslinkCommitteesAtSlot(state, attestationData.slot);
// function getAttestationParticipants(state: BeaconState, attestationData: AttestationData, bitfield: bytes): int[] {

export function getAttestationParticipants(state: BeaconState, attestationData: AttestationData, bitfield: bytes): ValidatorIndex[] {
  return [] as ValidatorIndex[];
}

//   const crosslinkCommittees: Array<{ShardNumber, ValidatorIndex}> = getCrosslinkCommitteesAtSlot(state, attestationData.slot);
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
 * Determine the balance of a validator.
 * @param {BeaconState} state
 * @param {int} index
 * @returns {Number}
 */
export function getEffectiveBalance(state: BeaconState, index: ValidatorIndex): Gwei {
  const bnMax = new BN(MAX_DEPOSIT_AMOUNT);
  const vBal = state.validatorBalances[index];
  return vBal.lt(bnMax) ? vBal : bnMax;
}

/**
 * Return the combined effective balance of an array of validators.
 * @param {BeaconState} state
 * @param {ValidatorIndex[]} validators
 * @returns {Gwei}
 */
export function getTotalBalance(state: BeaconState, validators: ValidatorIndex[]): Gwei {
  return validators.reduce((acc: BN, cur: ValidatorIndex): BN => acc.add(getEffectiveBalance(state, cur)), new BN(0));
}

/**
 * Return the fork version of the given epoch.
 * @param {Fork} fork
 * @param {Epoch} epoch
 * @returns {Number}
 */
export function getForkVersion(fork: Fork, epoch: Epoch): number64 {
  return epoch < fork.epoch ? fork.previousVersion : fork.currentVersion;
}

/**
 * Get the domain number that represents the fork meta and signature domain.
 * @param {Fork} fork
 * @param {Epoch} epoch
 * @param {int} domainType
 * @returns {Number}
 */
export function getDomain(fork: Fork, epoch: Epoch, domainType: int): number64 {
  return (getForkVersion(fork, epoch) * (2 ** 32)) + domainType;
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function verifyBitfield(bitfield: bytes, committeeSize: int): bool {
  return true;
}

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
  return targetEpoch1 === targetEpoch2;
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
    sourceEpoch1 < sourceEpoch2 &&
    targetEpoch2 < targetEpoch1
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
  return epoch + 1 + ACTIVATION_EXIT_DELAY;
}

/**
 * Verify validity of ``slashable_attestation`` fields.
 * @param {BeaconState} state
 * @param {SlashableAttestation} slashableAttesation
 * @returns {bool}
 */
export function verifySlashableAttestation(state: BeaconState, slashableAttestation: SlashableAttestation): bool {
  // Remove conditional in Phase 1
  if (!slashableAttestation.custodyBitfield.equals(Buffer.alloc(slashableAttestation.custodyBitfield.length))) {
    return false;
  }

  if (slashableAttestation.validatorIndices.length === 0) {
    return false;
  }

  for (let i = 0; i < slashableAttestation.validatorIndices.length; i++) {
    if (slashableAttestation.validatorIndices[i] >= slashableAttestation.validatorIndices[i + 1]) {
      return false;
    }
  }

  if (!verifyBitfield(slashableAttestation.custodyBitfield, slashableAttestation.validatorIndices.length)) {
    return false;
  }

  if (slashableAttestation.validatorIndices.length > MAX_INDICES_PER_SLASHABLE_VOTE) {
    return false;
  }

  const custodyBit0Indices = [];
  const custodyBit1Indices = [];
  for (let i = 0; i < slashableAttestation.validatorIndices.length; i++) {
    const validatorIndex = slashableAttestation.validatorIndices[i];
    if (getBitfieldBit(slashableAttestation.custodyBitfield, i) === 0) {
      custodyBit0Indices.push(validatorIndex);
    } else {
      custodyBit1Indices.push(validatorIndex);
    }
  }

  const dataAndCustodyBit0: AttestationDataAndCustodyBit = {
    data: slashableAttestation.data,
    custodyBit: false,
  };
  const dataAndCustodyBit1: AttestationDataAndCustodyBit = {
    data: slashableAttestation.data,
    custodyBit: true,
  };
  return blsVerifyMultiple(
    [
      blsAggregatePubkeys(custodyBit0Indices.map((i) => state.validatorRegistry[i].pubkey)),
      blsAggregatePubkeys(custodyBit1Indices.map((i) => state.validatorRegistry[i].pubkey)),
    ],
    [
      hashTreeRoot(dataAndCustodyBit0, AttestationDataAndCustodyBit),
      hashTreeRoot(dataAndCustodyBit1, AttestationDataAndCustodyBit),
    ],
    slashableAttestation.aggregateSignature,
    getDomain(state.fork, slotToEpoch(slashableAttestation.data.slot), Domain.ATTESTATION),
  );
}

/**
 * Verify that the given ``leaf`` is on the merkle branch ``branch``.
 * @param {bytes32} leaf
 * @param {bytes32[]} branch
 * @param {int} depth
 * @param {int} index
 * @param {bytes32} root
 * @returns {bool}
 */
export function verifyMerkleBranch(leaf: bytes32, branch: bytes32[], depth: int, index: int, root: bytes32): bool {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    if (Math.floor(index / (2 ** i)) % 2) {
      value = hash(Buffer.concat([branch[i], value]));
    } else {
      value = hash(Buffer.concat([value, branch[i]]));
    }
  }
  return value.equals(root);
}

/**
 * Validate a eth1 deposit
 * @param {BeaconState} state
 * @param {BLSPubkey} pubkey
 * @param {BLSSignature} proofOfPossession
 * @param {Bytes32} withdrawalCredentials
 * @returns {boolean}
 */
export function validateProofOfPossession(
  state: BeaconState,
  pubkey: BLSPubkey,
  proofOfPossession: BLSSignature,
  withdrawalCredentials: bytes32): boolean {
  const proofOfPossessionData: DepositInput = {
    pubkey,
    withdrawalCredentials,
    proofOfPossession: EMPTY_SIGNATURE,
  };
  return blsVerify(
    pubkey,
    hashTreeRoot(proofOfPossessionData, DepositInput),
    proofOfPossession,
    getDomain(
      state.fork,
      getCurrentEpoch(state),
      Domain.DEPOSIT,
    ),
  );
}

/**
 * Process a deposit from eth1.x to eth2.
 * @param {BeaconState} state
 * @param {BLSPubkey} pubkey
 * @param {Gwei} amount
 * @param {BLSSignature} proofOfPossession
 * @param {Bytes32} withdrawalCredentials
 */
export function processDeposit(
  state: BeaconState,
  pubkey: BLSPubkey,
  amount: Gwei,
  proofOfPossession: BLSSignature,
  withdrawalCredentials: bytes32): void {
  // Validate the given proofOfPossession
  assert(validateProofOfPossession(state, pubkey, proofOfPossession, withdrawalCredentials));

  const validatorPubkeys = state.validatorRegistry.map((v) => v.pubkey);

  if (!validatorPubkeys.includes(pubkey)) {
    // Add new validator
    const validator: Validator = {
      pubkey,
      withdrawalCredentials,
      activationEpoch: FAR_FUTURE_EPOCH,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawalEpoch: FAR_FUTURE_EPOCH,
      slashedEpoch: FAR_FUTURE_EPOCH,
      statusFlags: new BN(0),
    };

    // Note: In phase 2 registry indices that have been withdrawn for a long time will be recycled.
    state.validatorRegistry.push(validator);
    state.validatorBalances.push(amount);
  } else {
    // Increase balance by deposit amount
    const index = validatorPubkeys.indexOf(pubkey);
    assert(!state.validatorRegistry[index].withdrawalCredentials.equals(withdrawalCredentials), "Deposit already made!");
    state.validatorBalances[index] = state.validatorBalances[index].add(amount);
  }
}
