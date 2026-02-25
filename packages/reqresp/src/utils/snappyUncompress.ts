import {uncompress} from "snappyjs";
import {Uint8ArrayList} from "uint8arraylist";
import {ChunkType, IDENTIFIER, UNCOMPRESSED_CHUNK_SIZE, crc} from "./snappyCommon.js";

export function parseSnappyFrameHeader(header: Uint8Array): {type: ChunkType; frameSize: number} {
  if (header.length !== 4) {
    throw new Error("malformed input: incomplete frame header");
  }

  const type = getChunkType(header[0]);
  const frameSize = header[1] + (header[2] << 8) + (header[3] << 16);
  return {type, frameSize};
}

export function decodeSnappyFrameData(type: ChunkType, frame: Uint8Array): Uint8Array | null {
  switch (type) {
    case ChunkType.IDENTIFIER: {
      if (!Buffer.prototype.equals.call(frame, IDENTIFIER)) {
        throw new Error("malformed input: bad identifier");
      }
      return null;
    }
    case ChunkType.PADDING:
    case ChunkType.SKIPPABLE:
      return null;
    case ChunkType.COMPRESSED: {
      if (frame.length < 4) {
        throw new Error("malformed input: too short");
      }

      const checksum = frame.subarray(0, 4);
      const data = frame.subarray(4);
      const uncompressed = uncompress(data, UNCOMPRESSED_CHUNK_SIZE);
      if (crc(uncompressed).compare(checksum) !== 0) {
        throw new Error("malformed input: bad checksum");
      }
      return uncompressed;
    }
    case ChunkType.UNCOMPRESSED: {
      if (frame.length < 4) {
        throw new Error("malformed input: too short");
      }

      const checksum = frame.subarray(0, 4);
      const uncompressed = frame.subarray(4);
      if (uncompressed.length > UNCOMPRESSED_CHUNK_SIZE) {
        throw new Error("malformed input: too large");
      }
      if (crc(uncompressed).compare(checksum) !== 0) {
        throw new Error("malformed input: bad checksum");
      }
      return uncompressed;
    }
  }
}

export function decodeSnappyFrames(data: Uint8Array): Uint8ArrayList {
  const out = new Uint8ArrayList();
  let foundIdentifier = false;
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    if (remaining < 4) {
      throw new Error("malformed input: incomplete frame header");
    }

    const {type, frameSize} = parseSnappyFrameHeader(data.subarray(offset, offset + 4));
    if (!foundIdentifier && type !== ChunkType.IDENTIFIER) {
      throw new Error("malformed input: must begin with an identifier");
    }

    offset += 4;

    if (data.length - offset < frameSize) {
      throw new Error("malformed input: incomplete frame");
    }

    const frame = data.subarray(offset, offset + frameSize);
    offset += frameSize;

    if (type === ChunkType.IDENTIFIER) {
      foundIdentifier = true;
    }

    const uncompressed = decodeSnappyFrameData(type, frame);
    if (uncompressed !== null) {
      out.append(uncompressed);
    }
  }

  return out;
}

function getChunkType(value: number): ChunkType {
  switch (value) {
    case ChunkType.IDENTIFIER:
      return ChunkType.IDENTIFIER;
    case ChunkType.COMPRESSED:
      return ChunkType.COMPRESSED;
    case ChunkType.UNCOMPRESSED:
      return ChunkType.UNCOMPRESSED;
    case ChunkType.PADDING:
      return ChunkType.PADDING;
    default:
      // https://github.com/google/snappy/blob/main/framing_format.txt#L129
      if (value >= 0x80 && value <= 0xfd) {
        return ChunkType.SKIPPABLE;
      }
      throw new Error("Unsupported snappy chunk type");
  }
}
