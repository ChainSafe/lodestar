import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks, Slot} from "@chainsafe/lodestar-types";
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

export function getSignedBlockTypeFromBytes(
  config: IChainForkConfig,
  bytes: Buffer | Uint8Array
): ContainerType<allForks.SignedBeaconBlock> {
  const slot = getSlotFromBytes(bytes);
  return config.getForkTypes(slot).SignedBeaconBlock;
}

export function getSlotFromBytes(bytes: Buffer | Uint8Array): Slot {
  return bytesToInt(bytes.slice(SLOT_BYTES_POSITION_IN_BLOCK, SLOT_BYTES_POSITION_IN_BLOCK + SLOT_BYTE_COUNT));
}

export function getStateTypeFromBytes(
  config: IChainForkConfig,
  bytes: Buffer | Uint8Array
): ContainerType<allForks.BeaconState> {
  const slot = bytesToInt(bytes.slice(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
  return config.getForkTypes(slot).BeaconState;
}
