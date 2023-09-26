import {ChainForkConfig} from "@lodestar/config";
import {Slot, allForks} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

// TODO: merge to sszBytes.ts util
/**
 * Slot	uint64
 */
const SLOT_BYTE_COUNT = 8;

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
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksSSZTypes["SignedBeaconBlock"] {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }

  return config.getForkTypes(slot).SignedBeaconBlock;
}

export function getStateTypeFromBytes(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksSSZTypes["BeaconState"] {
  const slot = getStateSlotFromBytes(bytes);
  return config.getForkTypes(slot).BeaconState;
}

export function getStateSlotFromBytes(bytes: Uint8Array): Slot {
  return bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
}

/**
 * First field in update is beacon, first field in beacon is slot
 *
 * header = {
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
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksLightClientSSZTypes["LightClientHeader"] {
  const slot = bytesToInt(
    bytes.subarray(SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER, SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER + SLOT_BYTE_COUNT)
  );
  return config.getLightClientForkTypes(slot).LightClientHeader;
}
