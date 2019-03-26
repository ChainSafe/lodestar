import {
  Attestation,
  BeaconBlock,
  BeaconState,
  int,
  PendingAttestation,
  Slot,
  Validator,
  ValidatorIndex,
} from "../../types";

import {
  FORK_CHOICE_BALANCE_INCREMENT,
} from "../../constants";

import {
  getActiveValidatorIndices,
  getEffectiveBalance,
  slotToEpoch,
} from "../helpers/stateTransitionHelpers";


// Probably add this as a field to BeaconState
interface Store {
  blocks: BeaconBlock[];
  pendingAttestations: PendingAttestation[];
  validatorRegistry: Validator[];
}

interface AttestationTarget {
  validatorIndex: ValidatorIndex;
  target: BeaconBlock;
}

/**
 * Get the ancestor of block with slot number slot; return None if not found.
 * @param {Store} store
 * @param {BeaconBlock} block
 * @param {slot} slot
 * @returns {BeaconBlock}
 */
function getAncestor(store: Store, block: BeaconBlock, slot: Slot): BeaconBlock | null {
  if (block.slot === slot) {
    return block;
  } else if (block.slot < slot) {
    return null;
  } else {
    // TODO Find way to access parent block properly
    return getAncestor(store, store.blocks.pop(), slot);
  }
}

/**
 * Return the attetation with the highest slot number in store given validator index.
 * @param {Store} store
 * @param {ValidatorIndex} validatorIndex
 * @returns {Attestation}
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getLatestAttestation(store: Store, validatorIndex: ValidatorIndex): Attestation {
  const validator: Validator = store.validatorRegistry[validatorIndex];
  const attestation = store.pendingAttestations
  // NOTE: This may not be correct
    .filter((a) => a.aggregationBitfield === validator.pubkey)
    .reduce((prev: PendingAttestation, cur: PendingAttestation) => prev.data.slot < cur.data.slot ?  cur : prev);
  // If there are more than one, return the index 0
  return attestation[0];
}

// TODO FINSIH
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getLatestAttestationTarget(store: Store, validatorIndex: ValidatorIndex): BeaconBlock {
  // const attestation = getLatestAttestation(store, validatorIndex);
  return store.blocks[store.blocks.length - 1];
}

/**
 * Returns child blocks of a given block.
 * @param {Store} store
 * @param {BeaconBlock} block
 * @returns {BeaconBlock[]}
 */
function getChildren(store: Store, block: BeaconBlock): BeaconBlock[] {
  // TODO Finish
  return [block];
}

/**
 * Execute the LMD-GHOST algorithm to find the head BeaconBlock
 * @param {Store} store
 * @param {BeaconState} startState
 * @param {BeaconBlock} startBlock
 * @returns {BeaconBlock}
 */
export function lmdGhost(store: Store, startState: BeaconState, startBlock: BeaconBlock): BeaconBlock {
  const validators = startState.validatorRegistry;
  const activeValidatorIndices: ValidatorIndex[] = getActiveValidatorIndices(validators, slotToEpoch(startState.slot));

  const attestationTargets: AttestationTarget[] = [];
  for (const validatorIndex of activeValidatorIndices) {
    attestationTargets.push({validatorIndex, target: getLatestAttestationTarget(store, validatorIndex)});
  }

  // Inner function
  function getVoteCount(block: BeaconBlock): int {
    let sum = 0;
    for (const target of attestationTargets) {
      if (getAncestor(store, target[1], block.slot) === block) {
        sum += Math.floor(getEffectiveBalance(startState, target[0]).toNumber() / FORK_CHOICE_BALANCE_INCREMENT);
      }
    }
    return sum;
  }

  let head = startBlock;
  while (1) {
    const children = getChildren(store, head);
    if (children.length === 0) {
      return head;
    }
    head = children.reduce((a, c) => getVoteCount(a) < getVoteCount(c) ? c : a);
  }
}
