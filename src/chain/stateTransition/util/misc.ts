import assert from "assert";

import {
  ACTIVATION_EXIT_DELAY,
  CHURN_LIMIT_QUOTIENT,
  EMPTY_SIGNATURE,
  MAX_EFFECTIVE_BALANCE,
  MIN_PER_EPOCH_CHURN_LIMIT,
  SLOTS_PER_HISTORICAL_ROOT,
  ZERO_HASH,
} from "../../../constants";

import {
  BeaconState,
  BeaconBlock,
  BeaconBlockBody,
  bytes8,
  bytes32,
  Epoch,
  Slot,
  ValidatorIndex,
  BeaconBlockHeader,
} from "../../../types";

import {intDiv} from "../../../util/math";
import {hash} from "../../../util/crypto";
import {intToBytes} from "../../../util/bytes";

import {getCurrentEpoch, getEpochStartSlot} from "./epoch";

import {getActiveValidatorIndices} from "./validator";

import {generateSeed} from "./seed";

import {getCrosslinkCommitteesAtSlot} from "./crosslinkCommittee";
import {hashTreeRoot} from "@chainsafe/ssz";


/**
 * Return the block root at a recent ``slot``.
 * @param {BeaconState} state
 * @param {Slot} slot
 * @returns {bytes32}
 */
export function getBlockRootAtSlot(state: BeaconState, slot: Slot): bytes32 {
  assert(slot < state.slot);
  assert(state.slot <= slot + SLOTS_PER_HISTORICAL_ROOT);
  return state.latestBlockRoots[slot % SLOTS_PER_HISTORICAL_ROOT];
}

/**
 * Return the block root at a recent ``epoch``.
 * @param {BeaconState} state
 * @param {Epoch} epoch
 * @returns {bytes32}
 */
export function getBlockRoot(state: BeaconState, epoch: Epoch): bytes32 {
  return getBlockRootAtSlot(state, getEpochStartSlot(epoch));
}

/**
 * Return the state root at a recent ``slot``.
 * @param {BeaconState} state
 * @param {Slot} slot
 * @returns {bytes32}
 */
export function getStateRoot(state: BeaconState, slot: Slot): bytes32 {
  assert(slot < state.slot);
  assert(state.slot <= slot + SLOTS_PER_HISTORICAL_ROOT);
  return state.latestStateRoots[slot % SLOTS_PER_HISTORICAL_ROOT];
}

/**
 * Return the beacon proposer index at ``state.slot``.
 * @param {BeaconState} state
 * @returns {ValidatorIndex}
 */
export function getBeaconProposerIndex(state: BeaconState): ValidatorIndex {
  const currentEpoch = getCurrentEpoch(state);
  const [firstCommittee, _] = getCrosslinkCommitteesAtSlot(state, state.slot)[0];
  let i = 0;
  while (true) {
    const candidateIndex = firstCommittee[(currentEpoch + i) % firstCommittee.length];
    const randByte = hash(Buffer.concat([
      generateSeed(state, currentEpoch),
      intToBytes(intDiv(i, 32), 8),
    ]))[i % 32];
    const effectiveBalance = state.validatorRegistry[candidateIndex].effectiveBalance;
    if (effectiveBalance.muln(255).gten(MAX_EFFECTIVE_BALANCE * randByte)) {
      return candidateIndex;
    }
    i += 1;
  }
}

/**
 * Verify that the given ``leaf`` is on the merkle branch ``proof``
 * starting with the given ``root``.
 * @param {bytes32} leaf
 * @param {bytes32[]} proof
 * @param {number} depth
 * @param {number} index
 * @param {bytes32} root
 * @returns {bool}
 */
export function verifyMerkleBranch(leaf: bytes32, proof: bytes32[], depth: number, index: number, root: bytes32): boolean {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    if (intDiv(index, 2**i) % 2) {
      value = hash(Buffer.concat([proof[i], value]));
    } else {
      value = hash(Buffer.concat([value, proof[i]]));
    }
  }
  return value.equals(root);
}

/**
 * Return the signature domain (fork version concatenated with domain type) of a message.
 * @param {Fork} fork
 * @param {Epoch} epoch
 * @param {number} domainType
 * @returns {bytes8}
 */
export function getDomain(state: BeaconState, domainType: number, messageEpoch: Epoch | null = null): bytes8 {
  const epoch = messageEpoch || getCurrentEpoch(state);
  return Buffer.concat([
    epoch < state.fork.epoch ? state.fork.previousVersion : state.fork.currentVersion,
    intToBytes(domainType, 4),
  ]);
}

/**
 * @param {BeaconState} state
 * @returns {number}
 */
export function getChurnLimit(state: BeaconState): number {
  return Math.max(
    MIN_PER_EPOCH_CHURN_LIMIT,
    intDiv(getActiveValidatorIndices(state, getCurrentEpoch(state)).length, CHURN_LIMIT_QUOTIENT),
  );
}

/**                       
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
 * @param {BeaconBlock} block
 * @returns {BeaconBlockHeader} 
 */                                                                                      
export function getTemporaryBlockHeader(block: BeaconBlock): BeaconBlockHeader {
  return {
    slot: block.slot,
    previousBlockRoot: block.previousBlockRoot,
    stateRoot: ZERO_HASH,        
    blockBodyRoot: hashTreeRoot(block.body, BeaconBlockBody),
    signature: EMPTY_SIGNATURE,          
  };                                 
}
