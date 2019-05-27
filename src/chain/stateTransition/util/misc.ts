/**
 * @module chain/stateTransition/util
 */

import assert from "assert";

import {
  CHURN_LIMIT_QUOTIENT, Domain,
  EMPTY_SIGNATURE,
  MAX_EFFECTIVE_BALANCE,
  MIN_PER_EPOCH_CHURN_LIMIT,
  SLOTS_PER_HISTORICAL_ROOT,
  ZERO_HASH,
  SLOTS_PER_EPOCH,
  SHARD_COUNT,
} from "../../../constants";

import {
  BeaconState,
  BeaconBlock,
  BeaconBlockBody,
  bytes32,
  Epoch,
  Slot,
  ValidatorIndex,
  BeaconBlockHeader, Fork,
} from "../../../types";

import {
  getCrosslinkCommittee,
  getEpochCommitteeCount,
  getEpochStartShard
} from "./crosslinkCommittee";

import {intDiv} from "../../../util/math";
import {hash} from "../../../util/crypto";
import {intToBytes} from "../../../util/bytes";

import {getCurrentEpoch, getEpochStartSlot} from "./epoch";

import {getActiveValidatorIndices} from "./validator";

import {generateSeed} from "./seed";

import {hashTreeRoot} from "@chainsafe/ssz";
import {BLSDomain} from "@chainsafe/bls-js/lib/types";


/**
 * Return the block root at a recent ``slot``.
 */
export function getBlockRootAtSlot(state: BeaconState, slot: Slot): bytes32 {
  assert(slot < state.slot);
  assert(state.slot <= slot + SLOTS_PER_HISTORICAL_ROOT);
  return state.latestBlockRoots[slot % SLOTS_PER_HISTORICAL_ROOT];
}

/**
 * Return the block root at a recent ``epoch``.
 */
export function getBlockRoot(state: BeaconState, epoch: Epoch): bytes32 {
  return getBlockRootAtSlot(state, getEpochStartSlot(epoch));
}

/**
 * Return the beacon proposer index at ``state.slot``.
 */
export function getBeaconProposerIndex(state: BeaconState): ValidatorIndex {
  const currentEpoch = getCurrentEpoch(state);
  const committeesPerSlot = intDiv(getEpochCommitteeCount(state, currentEpoch), SLOTS_PER_EPOCH);
  const offset = committeesPerSlot * (state.slot % SLOTS_PER_EPOCH);
  const shard = (getEpochStartShard(state, currentEpoch) + offset) % SHARD_COUNT;
  const firstCommittee = getCrosslinkCommittee(state, currentEpoch, shard);
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
 * Return the signature domain (fork version concatenated with domain type) of a message.
 */
export function getDomain(
  state: BeaconState,
  domainType: number,
  messageEpoch: Epoch | null = null
): BLSDomain {
  const epoch = messageEpoch || getCurrentEpoch(state);
  return getDomainFromFork(state.fork, epoch, domainType);
}

export function getDomainFromFork(fork: Fork, epoch: Epoch, domainType: Domain): BLSDomain {
  const forkVersion = epoch < fork.epoch ? fork.previousVersion : fork.currentVersion;
  return Buffer.concat([
    forkVersion,
    intToBytes(domainType, 4)
  ]);
}

/**
 * Return the churn limit based on the active validator count.
 */
export function getChurnLimit(state: BeaconState): number {
  return Math.max(
    MIN_PER_EPOCH_CHURN_LIMIT,
    intDiv(getActiveValidatorIndices(state, getCurrentEpoch(state)).length, CHURN_LIMIT_QUOTIENT),
  );
}

/**
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
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
