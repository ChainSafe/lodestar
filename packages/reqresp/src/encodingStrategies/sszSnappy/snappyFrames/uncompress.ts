import {uncompress} from "snappyjs";
import {Uint8ArrayList} from "uint8arraylist";

const IDENTIFIER = Buffer.from([0x73, 0x4e, 0x61, 0x50, 0x70, 0x59]);

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
      const frameSize = getFrameSize(this.buffer, 1);

      if (this.buffer.length - 4 < frameSize) {
        break;
      }

      const data = this.buffer.subarray(4, 4 + frameSize);
      this.buffer.consume(4 + frameSize);

      if (!this.state.foundIdentifier && type !== ChunkType.IDENTIFIER) {
        throw "malformed input: must begin with an identifier";
      }

      if (type === ChunkType.IDENTIFIER) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        if (!Buffer.prototype.equals.call(data, IDENTIFIER)) {
          throw "malformed input: bad identifier";
        }
        this.state.foundIdentifier = true;
        continue;
      }

      if (type === ChunkType.COMPRESSED) {
        result.append(uncompress(data.subarray(4)));
      }
      if (type === ChunkType.UNCOMPRESSED) {
        result.append(data.subarray(4));
      }
    }
    if (result.length === 0) {
      return null;
    } else {
      return result;
    }
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

enum ChunkType {
  IDENTIFIER = 0xff,
  COMPRESSED = 0x00,
  UNCOMPRESSED = 0x01,
  PADDING = 0xfe,
}

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
      throw new Error("Unsupported snappy chunk type");
  }
}
