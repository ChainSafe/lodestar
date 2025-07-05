/**
 * Known entry types in an E2Store (.e2s) file.
 * Values are the exact 2-byte type codes as defined in the specification.
 */
export const E2StoreEntryType = {
  Empty: new Uint8Array([0x00, 0x00]),
  CompressedSignedBeaconBlock: new Uint8Array([0x01, 0x00]),
  CompressedBeaconState: new Uint8Array([0x02, 0x00]),
  Version: new Uint8Array([0x65, 0x32]), // "e2" in ASCII
  SlotIndex: new Uint8Array([0x69, 0x32]), // "i2" in ASCII
} as const;

/**
 * The complete version record (8 bytes total).
 */
export const VERSION_RECORD_BYTES = new Uint8Array([0x65, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

/**
 * Binary format constants.
 */
export const E2STORE_HEADER_SIZE = 8;
export const SLOT_INDEX_ENTRY_SIZE = 8;
export const MIN_SLOT_INDEX_SIZE = 32; // header(8) + startSlot(8) + 1 offset(8) + count(8)
