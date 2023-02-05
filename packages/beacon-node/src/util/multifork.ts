import {IChainForkConfig} from "@lodestar/config";
import {allForks, Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";

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
): allForks.AllForksSSZTypes["SignedBeaconBlock"] {
  const slot = getSlotFromBytes(bytes);
  return config.getForkTypes(slot).SignedBeaconBlock;
}

export function getSlotFromBytes(bytes: Buffer | Uint8Array): Slot {
  return bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_BLOCK, SLOT_BYTES_POSITION_IN_BLOCK + SLOT_BYTE_COUNT));
}

export function getStateTypeFromBytes(
  config: IChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksSSZTypes["BeaconState"] {
  const slot = bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
  return config.getForkTypes(slot).BeaconState;
}

/**
 * First field in update is beacon, first field in beacon is slot
 *
 * update = {
 * attestedHeader: {
 *  beacon: {
 *   slot
 *   ...
 *  }
 * }
 *  ...
 * }
 *   ...
 */
const SLOT_BYTES_POSITION_IN_LIGHTCLIENTUPDATE = 0;
export function getLightClientUpdateTypeFromBytes(
  config: IChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksLightClientSSZTypes["LightClientUpdate"] {
  const slot = bytesToInt(
    bytes.subarray(SLOT_BYTES_POSITION_IN_LIGHTCLIENTUPDATE, SLOT_BYTES_POSITION_IN_LIGHTCLIENTUPDATE + SLOT_BYTE_COUNT)
  );
  return config.getLightClientForkTypes(slot).LightClientUpdate;
}

/**
 * First field in update is beacon, first field in beacon is slot
 *
 * update = {
 *  beacon: {
 *   slot
 *   ...
 *  }
 *  ...
 * }
 *   ...
 */
const SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER = 0;
export function getLightClientHeaderTypeFromBytes(
  config: IChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksLightClientSSZTypes["LightClientHeader"] {
  const slot = bytesToInt(
    bytes.subarray(SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER, SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER + SLOT_BYTE_COUNT)
  );
  return config.getLightClientForkTypes(slot).LightClientHeader;
}
