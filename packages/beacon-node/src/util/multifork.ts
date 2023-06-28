import {ChainForkConfig} from "@lodestar/config";
import {allForks} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

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

export function getSignedBlockTypeFromBytes<T extends boolean>(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array,
  isBlinded: T
): T extends true
  ? allForks.AllForksBlindedSSZTypes["SignedBeaconBlock"]
  : allForks.AllForksSSZTypes["SignedBeaconBlock"];
export function getSignedBlockTypeFromBytes(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array,
  isBlinded: boolean
): allForks.AllForksBlindedSSZTypes["SignedBeaconBlock"] | allForks.AllForksSSZTypes["SignedBeaconBlock"] {
  // slot offset is same for blinded and full blocks
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }

  if (isBlinded) {
    return config.getBlindedForkTypes(slot).SignedBeaconBlock;
  }
  return config.getForkTypes(slot).SignedBeaconBlock;
}

export function getStateTypeFromBytes(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): allForks.AllForksSSZTypes["BeaconState"] {
  const slot = bytesToInt(bytes.subarray(SLOT_BYTES_POSITION_IN_STATE, SLOT_BYTES_POSITION_IN_STATE + SLOT_BYTE_COUNT));
  return config.getForkTypes(slot).BeaconState;
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
