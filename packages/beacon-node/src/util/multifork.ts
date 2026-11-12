import {ChainForkConfig} from "@lodestar/config";
import {ForkAll, ForkPostAltair} from "@lodestar/params";
import {SSZTypesFor, Slot} from "@lodestar/types";
import {bytesToInt} from "@lodestar/utils";
import {getSlotFromSignedBeaconBlockSerialized} from "./sszBytes.js";

/**
 * Slot	uint64
 */
const SLOT_BYTE_COUNT = 8;

/**
 * SSZ offset uint32
 */
const OFFSET_BYTE_COUNT = 4;

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
): SSZTypesFor<ForkAll, "SignedBeaconBlock"> {
  const slot = getSlotFromSignedBeaconBlockSerialized(bytes);
  if (slot === null) {
    throw Error("getSignedBlockTypeFromBytes: invalid bytes");
  }

  return config.getForkTypes(slot).SignedBeaconBlock;
}

export function getStateTypeFromBytes(
  config: ChainForkConfig,
  bytes: Buffer | Uint8Array
): SSZTypesFor<ForkAll, "BeaconState"> {
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
): SSZTypesFor<ForkPostAltair, "LightClientHeader"> {
  const slot = bytesToInt(
    bytes.subarray(SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER, SLOT_BYTES_POSITION_IN_LIGHTCLIENTHEADER + SLOT_BYTE_COUNT)
  );
  return config.getPostAltairForkTypes(slot).LightClientHeader;
}

/**
 * Position of first offset in DataColumnSidecar (after index field)
 *
 * Fulu DataColumnSidecar (6 fields):
 *   index: uint64 [fixed - 8 bytes]
 *   column: List [variable - 4-byte offset]
 *   kzgCommitments: List [variable - 4-byte offset]
 *   kzgProofs: List [variable - 4-byte offset]
 *   signedBlockHeader: Container [fixed - 208 bytes]
 *   kzgCommitmentsInclusionProof: Vector[Bytes32, 4] [fixed - 128 bytes]
 *   => First offset value = 8 + 4 + 4 + 4 + 208 + 128 = 356
 *
 * Gloas DataColumnSidecar (5 fields):
 *   index: uint64 [fixed - 8 bytes]
 *   column: List [variable - 4-byte offset]
 *   kzgProofs: List [variable - 4-byte offset]
 *   slot: uint64 [fixed - 8 bytes]
 *   beaconBlockRoot: Bytes32 [fixed - 32 bytes]
 *   => First offset value = 8 + 4 + 4 + 8 + 32 = 56
 */
const FIRST_OFFSET_POSITION_IN_DATA_COLUMN_SIDECAR = 8;
const GLOAS_DATA_COLUMN_SIDECAR_FIRST_OFFSET = 56;

/**
 * Determines if DataColumnSidecar bytes are from Gloas fork by checking the SSZ offset structure.
 *
 * The first offset (bytes 8-12) indicates where variable-size data begins:
 * - Gloas: 56 (small fixed section)
 * - Fulu: 356
 */
export function isGloasDataColumnSidecarBytes(bytes: Uint8Array): boolean {
  const firstOffset = bytesToInt(
    bytes.subarray(
      FIRST_OFFSET_POSITION_IN_DATA_COLUMN_SIDECAR,
      FIRST_OFFSET_POSITION_IN_DATA_COLUMN_SIDECAR + OFFSET_BYTE_COUNT
    )
  );
  return firstOffset === GLOAS_DATA_COLUMN_SIDECAR_FIRST_OFFSET;
}
