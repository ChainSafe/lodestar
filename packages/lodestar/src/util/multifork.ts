import {ForkName, IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0, Slot} from "@chainsafe/lodestar-types";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {ContainerType} from "@chainsafe/ssz";

/**
 * Slot	uint64
 */
const SLOT_BYTE_COUNT = 8;
/**
 * 4 + 96 = 100
 * ```
 * class SignedBeaconBlock(Container):
 *   message: BeaconBlock [offset - 4 bytes]
 *   signature: BLSSignature [fixed - 96 bytes]
 *
 * class BeaconBlock(Container):
 *   slot: Slot [fixed - 8 bytes]
 *   proposer_index: ValidatorIndex
 *   parent_root: Root
 *   state_root: Root
 *   body: BeaconBlockBody
 * ```
 */
const SLOT_BYTES_POSITION_IN_BLOCK = 100;
/**
 * 8 + 32 = 40
 * ```
 * class BeaconState(Container):
 *   genesis_time: uint64 [fixed - 8 bytes]
 *   genesis_validators_root: Root [fixed - 32 bytes]
 *   slot: Slot [fixed - 8 bytes]
 *   ...
 * ```
 */
const SLOT_BYTES_POSITION_IN_STATE = 40;

type BlockType = ContainerType<phase0.BeaconBlock>;
type SignedBlockType = ContainerType<phase0.SignedBeaconBlock>;
type StateType = ContainerType<allForks.BeaconState>;

// Block

export function getBlockType(config: IBeaconConfig, block: allForks.BeaconBlock): BlockType {
  return getBlockTypeFromSlot(config, block.slot);
}

function getBlockTypeFromSlot(config: IBeaconConfig, slot: Slot): BlockType {
  switch (config.getForkName(slot)) {
    case ForkName.phase0:
      return (config.types.phase0.BeaconBlock as unknown) as BlockType;
    case ForkName.altair:
      return (config.types.altair.BeaconBlock as unknown) as BlockType;
  }
}

// SignedBlock

export function getSignedBlockType(config: IBeaconConfig, block: allForks.SignedBeaconBlock): SignedBlockType {
  return getSignedBlockTypeFromSlot(config, block.message.slot);
}

export function getSignedBlockTypeFromBytes(config: IBeaconConfig, bytes: Buffer): SignedBlockType {
  const slot = bytesToInt(bytes.slice(SLOT_BYTES_POSITION_IN_BLOCK, SLOT_BYTES_POSITION_IN_BLOCK + SLOT_BYTE_COUNT));
  return getSignedBlockTypeFromSlot(config, slot);
}

function getSignedBlockTypeFromSlot(config: IBeaconConfig, slot: Slot): SignedBlockType {
  switch (config.getForkName(slot)) {
    case ForkName.phase0:
      return (config.types.phase0.SignedBeaconBlock as unknown) as SignedBlockType;
    case ForkName.altair:
      return (config.types.altair.SignedBeaconBlock as unknown) as SignedBlockType;
  }
}

// State

export function getStateTypeFromState(config: IBeaconConfig, state: allForks.BeaconState): StateType {
  return getStateTypeFromSlot(config, state.slot);
}

export function getStateTypeFromBytes(config: IBeaconConfig, bytes: Buffer): StateType {
  const slot = bytesToInt(bytes.slice(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
  return getStateTypeFromSlot(config, slot);
}

function getStateTypeFromSlot(config: IBeaconConfig, slot: Slot): StateType {
  switch (config.getForkName(slot)) {
    case ForkName.phase0:
      return (config.types.phase0.BeaconState as unknown) as StateType;
    case ForkName.altair:
      return (config.types.altair.BeaconState as unknown) as StateType;
  }
}
