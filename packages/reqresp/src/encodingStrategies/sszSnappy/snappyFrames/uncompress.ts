import {uncompress} from "snappyjs";
import {Uint8ArrayList} from "uint8arraylist";
import {ChunkType, IDENTIFIER, UNCOMPRESSED_CHUNK_SIZE, crc} from "./common.js";

export class SnappyFramesUncompress {
  private buffer = new Uint8ArrayList();

  private state: UncompressState = {
    foundIdentifier: false,
  };

  /**
   * Accepts chunk of data containing some part of snappy frames stream
   * @param chunk
   * @return Buffer if there is one or more whole frames, null if it's partial
   */
  uncompress(chunk: Uint8ArrayList): Uint8ArrayList | null {
    this.buffer.append(chunk);
    const result = new Uint8ArrayList();
    while (this.buffer.length > 0) {
      if (this.buffer.length < 4) break;

      const type = getChunkType(this.buffer.get(0));

      if (!this.state.foundIdentifier && type !== ChunkType.IDENTIFIER) {
        throw "malformed input: must begin with an identifier";
      }

      const frameSize = getFrameSize(this.buffer, 1);

      if (this.buffer.length - 4 < frameSize) {
        break;
      }

      const frame = this.buffer.subarray(4, 4 + frameSize);
      this.buffer.consume(4 + frameSize);

      switch (type) {
        case ChunkType.IDENTIFIER: {
          if (!Buffer.prototype.equals.call(frame, IDENTIFIER)) {
            throw "malformed input: bad identifier";
          }
          this.state.foundIdentifier = true;
          continue;
        }
        case ChunkType.PADDING:
        case ChunkType.SKIPPABLE:
          continue;
        case ChunkType.COMPRESSED: {
          const checksum = frame.subarray(0, 4);
          const data = frame.subarray(4);

          const uncompressed = uncompress(data, UNCOMPRESSED_CHUNK_SIZE);
          if (crc(uncompressed).compare(checksum) !== 0) {
            throw "malformed input: bad checksum";
          }
          result.append(uncompressed);
          break;
        }
        case ChunkType.UNCOMPRESSED: {
          const checksum = frame.subarray(0, 4);
          const uncompressed = frame.subarray(4);

          if (uncompressed.length > UNCOMPRESSED_CHUNK_SIZE) {
            throw "malformed input: too large";
          }
          if (crc(uncompressed).compare(checksum) !== 0) {
            throw "malformed input: bad checksum";
          }
          result.append(uncompressed);
          break;
        }
      }
    }
    if (result.length === 0) {
      return null;
    }
    return result;
  }

  reset(): void {
    this.buffer = new Uint8ArrayList();
    this.state = {
      foundIdentifier: false,
    };
  }
}

type UncompressState = {
  foundIdentifier: boolean;
};

function getFrameSize(buffer: Uint8ArrayList, offset: number): number {
  return buffer.get(offset) + (buffer.get(offset + 1) << 8) + (buffer.get(offset + 2) << 16);
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
