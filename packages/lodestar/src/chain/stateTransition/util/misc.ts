/**
 * @module chain/stateTransition/util
 */

import assert from "assert";
import {hashTreeRoot} from "@chainsafe/ssz";
import {BLSDomain} from "@chainsafe/bls-js/lib/types";

import {Domain, EMPTY_SIGNATURE, ZERO_HASH,} from "../../../constants";

import {
  BeaconBlock,
  BeaconBlockHeader,
  BeaconState,
  bytes32,
  bytes4,
  Epoch,
  Fork,
  Slot,
  ValidatorIndex,
} from "@chainsafe/eth2-types";
import {IBeaconConfig} from "../../../config";

import {intDiv} from "../../../util/math";
import {hash} from "../../../util/crypto";
import {bytesToBN, intToBytes} from "../../../util/bytes";

import {getCrosslinkCommittee, getEpochCommitteeCount, getEpochStartShard} from "./crosslinkCommittee";
import {getCurrentEpoch, getEpochStartSlot} from "./epoch";
import {getActiveValidatorIndices} from "./validator";
import {generateSeed} from "./seed";


/**
 * Return the block root at a recent ``slot``.
 */
export function getBlockRootAtSlot(config: IBeaconConfig, state: BeaconState, slot: Slot): bytes32 {
  assert(slot < state.slot);
  assert(state.slot <= slot + config.params.SLOTS_PER_HISTORICAL_ROOT);
  return state.latestBlockRoots[slot % config.params.SLOTS_PER_HISTORICAL_ROOT];
}

/**
 * Return the block root at a recent ``epoch``.
 */
export function getBlockRoot(config: IBeaconConfig, state: BeaconState, epoch: Epoch): bytes32 {
  return getBlockRootAtSlot(config, state, getEpochStartSlot(config, epoch));
}

/**
 * Return the beacon proposer index at ``state.slot``.
 */
export function getBeaconProposerIndex(config: IBeaconConfig, state: BeaconState): ValidatorIndex {
  const currentEpoch = getCurrentEpoch(config, state);
  const committeesPerSlot = intDiv(getEpochCommitteeCount(config, state, currentEpoch), config.params.SLOTS_PER_EPOCH);
  const offset = committeesPerSlot * (state.slot % config.params.SLOTS_PER_EPOCH);
  const shard = (getEpochStartShard(config, state, currentEpoch) + offset) % config.params.SHARD_COUNT;
  const firstCommittee = getCrosslinkCommittee(config, state, currentEpoch, shard);
  let i = 0;
  while (true) {
    const candidateIndex = firstCommittee[(currentEpoch + i) % firstCommittee.length];
    const randByte = hash(Buffer.concat([
      generateSeed(config, state, currentEpoch),
      intToBytes(intDiv(i, 32), 8),
    ]))[i % 32];
    const effectiveBalance = state.validatorRegistry[candidateIndex].effectiveBalance;
    if (effectiveBalance.muln(255).gte(config.params.MAX_EFFECTIVE_BALANCE.muln(randByte))) {
      return candidateIndex;
    }
    i += 1;
  }
}

/**
 * Return the signature domain (fork version concatenated with domain type) of a message.
 */
export function getDomain(
  config: IBeaconConfig,
  state: BeaconState,
  domainType: number,
  messageEpoch: Epoch | null = null
): BLSDomain {
  const epoch = messageEpoch || getCurrentEpoch(config, state);
  return getDomainFromFork(state.fork, epoch, domainType);
}

export function getDomainFromFork(fork: Fork, epoch: Epoch, domainType: Domain): BLSDomain {
  const forkVersion = epoch < fork.epoch ? fork.previousVersion : fork.currentVersion;
  return blsDomain(domainType, forkVersion);
}

/**
 * Return the bls domain given by the ``domain_type`` and 4 byte ``fork_version``
 */
export function blsDomain(domainType: Domain, forkVersion: bytes4): BLSDomain {
  return bytesToBN(Buffer.concat([
    intToBytes(domainType, 4),
    forkVersion,
  ])).toBuffer('be', 8);
}

/**
 * Return the churn limit based on the active validator count.
 */
export function getChurnLimit(config: IBeaconConfig, state: BeaconState): number {
  return Math.max(
    config.params.MIN_PER_EPOCH_CHURN_LIMIT,
    intDiv(getActiveValidatorIndices(state, getCurrentEpoch(config, state)).length, config.params.CHURN_LIMIT_QUOTIENT),
  );
}

/**
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
 */
export function getTemporaryBlockHeader(config: IBeaconConfig, block: BeaconBlock): BeaconBlockHeader {
  return {
    slot: block.slot,
    parentRoot: block.parentRoot,
    stateRoot: ZERO_HASH,
    bodyRoot: hashTreeRoot(block.body, config.types.BeaconBlockBody),
    signature: EMPTY_SIGNATURE,
  };
}
