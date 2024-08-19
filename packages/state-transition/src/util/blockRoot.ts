import {
  Epoch,
  Slot,
  Root,
  BeaconBlock,
  SignedBeaconBlock,
  BeaconBlockHeader,
  SignedBeaconBlockHeader,
  BlindedBeaconBlock,
} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_HISTORICAL_ROOT} from "@lodestar/params";
import {ZERO_HASH} from "../constants/index.js";
import {BeaconStateAllForks} from "../types.js";
import {computeStartSlotAtEpoch} from "./epoch.js";
import {blindedOrFullBlockBodyHashTreeRoot} from "./fullOrBlindedBlock.js";

/**
 * Return the block root at a recent [[slot]].
 */
export function getBlockRootAtSlot(state: BeaconStateAllForks, slot: Slot): Root {
  if (slot >= state.slot) {
    throw Error(`Can only get block root in the past currentSlot=${state.slot} slot=${slot}`);
  }
  if (slot < state.slot - SLOTS_PER_HISTORICAL_ROOT) {
    throw Error(`Cannot get block root more than ${SLOTS_PER_HISTORICAL_ROOT} in the past`);
  }
  return state.blockRoots.get(slot % SLOTS_PER_HISTORICAL_ROOT);
}

/**
 * Return the block root at the start of a recent [[epoch]].
 */
export function getBlockRoot(state: BeaconStateAllForks, epoch: Epoch): Root {
  return getBlockRootAtSlot(state, computeStartSlotAtEpoch(epoch));
}
/**
 * Return the block header corresponding to a block with ``state_root`` set to ``ZERO_HASH``.
 */
export function getTemporaryBlockHeader(config: ChainForkConfig, block: BeaconBlock): BeaconBlockHeader {
  return {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    // `state_root` is zeroed and overwritten in the next `process_slot` call
    stateRoot: ZERO_HASH,
    bodyRoot: config.getForkTypes(block.slot).BeaconBlockBody.hashTreeRoot(block.body),
  };
}

/**
 * Receives a FullOrBlindedBeaconBlock, and produces the corresponding BeaconBlockHeader.
 */
export function blockToHeader(config: ChainForkConfig, block: BeaconBlock | BlindedBeaconBlock): BeaconBlockHeader {
  const bodyRoot = blindedOrFullBlockBodyHashTreeRoot(config, block);
  return {
    stateRoot: block.stateRoot,
    proposerIndex: block.proposerIndex,
    slot: block.slot,
    parentRoot: block.parentRoot,
    bodyRoot,
  };
}

export function signedBlockToSignedHeader(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock
): SignedBeaconBlockHeader {
  const message = blockToHeader(config, signedBlock.message);
  const signature = signedBlock.signature;
  return {
    message,
    signature,
  };
}
