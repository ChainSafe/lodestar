/**
 * Known entry types in an E2Store (.e2s) file.
 */
export enum E2StoreEntryType {
  Empty = "Empty",
  CompressedSignedBeaconBlock = "CompressedSignedBeaconBlock",
  CompressedBeaconState = "CompressedBeaconState",
  Version = "Version",
  SlotIndex = "SlotIndex",
}

/**
 * The exact 2-byte type codes for E2StoreEntryType as defined in the specification.
 */
export const EraTypes = {
  [E2StoreEntryType.Empty]: new Uint8Array([0x00, 0x00]),
  [E2StoreEntryType.CompressedSignedBeaconBlock]: new Uint8Array([0x01, 0x00]),
  [E2StoreEntryType.CompressedBeaconState]: new Uint8Array([0x02, 0x00]),
  [E2StoreEntryType.Version]: new Uint8Array([0x65, 0x32]), // "e2" in ASCII
  [E2StoreEntryType.SlotIndex]: new Uint8Array([0x69, 0x32]), // "i2" in ASCII
};

/**
 * The complete version record (8 bytes total).
 */
export const VERSION_RECORD_BYTES = new Uint8Array([0x65, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

/**
 * E2Store header size in bytes
 */
export const E2STORE_HEADER_SIZE = 8;