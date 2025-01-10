import crc32c from "@chainsafe/fast-crc32c";

export enum ChunkType {
  IDENTIFIER = 0xff,
  COMPRESSED = 0x00,
  UNCOMPRESSED = 0x01,
  PADDING = 0xfe,
  SKIPPABLE = 0x80,
}

export const IDENTIFIER = Buffer.from([0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]);
export const IDENTIFIER_FRAME = Buffer.from([0xff, 0x06, 0x00, 0x00, 0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]);

/**
 * As per the snappy framing format for streams, the size of any uncompressed chunk can be
 * no longer than 65536 bytes.
 *
 * From: https://github.com/google/snappy/blob/main/framing_format.txt#L90:L92
 */
export const UNCOMPRESSED_CHUNK_SIZE = 65536;

export function crc(value: Uint8Array): Buffer {
  // this function doesn't actually need a buffer
  // see https://github.com/napi-rs/node-rs/blob/main/packages/crc32/index.d.ts
  const x = crc32c.calculate(value as Buffer);
  const result = Buffer.allocUnsafe?.(4) ?? Buffer.alloc(4);

  // As defined in section 3 of https://github.com/google/snappy/blob/master/framing_format.txt
  // And other implementations for reference:
  // Go: https://github.com/golang/snappy/blob/2e65f85255dbc3072edf28d6b5b8efc472979f5a/snappy.go#L97
  // Python: https://github.com/andrix/python-snappy/blob/602e9c10d743f71bef0bac5e4c4dffa17340d7b3/snappy/snappy.py#L70
  // Mask the right hand to (32 - 17) = 15 bits -> 0x7fff, to keep correct 32 bit values.
  // Shift the left hand with >>> for correct 32 bit intermediate result.
  // Then final >>> 0 for 32 bits output
  result.writeUInt32LE((((x >>> 15) | ((x & 0x7fff) << 17)) + 0xa282ead8) >>> 0, 0);

  return result;
}
